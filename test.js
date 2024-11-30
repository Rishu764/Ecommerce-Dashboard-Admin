import axios from "axios";
import {
  formatDate,
  getGeocodeData,
  getPrefDataFromJSONFile,
} from "../../helpers/utils.js";
import config from "../../config.js";
import Cubicasa from "../Cubicasa/index.js";
import Rela from "../Rela.js";
import Dropbox from "../Dropbox.js";
import redisclient from '../../libs/Redis.js';

const { JIRA_SITE_URL, JIRA_USEREMAIL, JIRA_API_TOKEN, JIRA_SITE_URL_TWO } =
  config;

const jiraApiURL = `${JIRA_SITE_URL}/rest/api/3`;
const jiraTwoApiURL = `${JIRA_SITE_URL_TWO}/rest/api/3`;

const authorization = `Basic ${Buffer.from(
  `${JIRA_USEREMAIL}:${JIRA_API_TOKEN}`
).toString("base64")}`;

class Jira {
  constructor(jiraStoreConfig = { jiraInstance: 1, dropboxInstance: 1, boardId: "11400" }) {
    this.jiraStoreConfig = jiraStoreConfig;
    this.axios = axios.create({
      baseURL: jiraStoreConfig.jiraInstance === 1 ? jiraApiURL : jiraTwoApiURL,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Entry function to handle the whole issue creation process
   * after getting the raw order from Rela
   *
   * @param {Object} rawOrderData
   * @returns {object}
   */
  async createIssueFromRelaOrder(rawOrderData) {
    this.eventType = "create";
    const issueData = await this.generateIssueDataFromRelaOrder(rawOrderData);
    // * 1 API call to create issue in Jira
    const issueKeys = await this.createIssuesInJira(issueData);
    if (issueKeys) {
      const linkResponse = await this.linkAllOrderIssue(issueKeys);
      if (!linkResponse) console.log(`Failed to link issues while creating issue`);
    }
    return issueKeys;
  }

  /**
   *
   *
   * @param {Object} rawOrderData
   * @returns {Object}
   */
  async updateIssuesFromRelaOrder(rawOrderData) {
    this.eventType = "update";
    console.log("rawOrderData.status", rawOrderData.status);
    if (rawOrderData.status === "canceled")
      return this.cancelIssueFromRelaOrder(rawOrderData);

    const issueData = await this.generateIssueDataFromRelaOrder(rawOrderData);

    const { newIssues, existingIssues, removedIssues } =
      await this.separateNewAndExistingIssues(issueData);

    const createNewIssuesResponse = await this.createIssuesInJira(newIssues);
    const updateBulkIssuesResponse = await this.updateBulkIssues(
      existingIssues
    );

    const removedIssuesId = removedIssues.filter(Boolean);
    const removeBulkIssuesResponse = await this.cancelMultipleIssues(
      removedIssuesId
    );

    // only link orders if there's new issues created
    if (createNewIssuesResponse && createNewIssuesResponse.length > 0) {
      const issueKeys = [
        ...(createNewIssuesResponse || []),
        ...existingIssues.map((data) => data.searchResult.key),
      ];

      const linkResponse = await this.linkAllOrderIssue(issueKeys);
      if (!linkResponse) console.log(`Failed to link issues in Jira while updating order`);
    }

    return {
      createNewIssuesResponse,
      updateBulkIssuesResponse,
      removeBulkIssuesResponse,
    };
  }

  async cancelIssueFromRelaOrder(rawOrderData) {
    console.log("Cancelling issues");
    const { products_list, id } = rawOrderData;

    if (Array.isArray(products_list) && products_list.length > 0) {
      const getCancelIssuesId = products_list.map(async (product) => {
        const issue = await this.getJiraIssueByOrder(id, product.name);
        if (issue && issue.id) {
          const { id, fields } = issue;
          const status = fields?.status?.name;
          const transitionId = this.getTransitionIdByStatus(status);
          if (transitionId) {
            return { id, transitionId };
          }
        }
      });

      const cancelIssuesIdResponse = await Promise.all(getCancelIssuesId);
      const cancelIssuesId = cancelIssuesIdResponse.filter(Boolean);
      console.log("cancelIssuesId", JSON.stringify(cancelIssuesId));
      if (cancelIssuesId && cancelIssuesId.length > 0)
        return await this.cancelMultipleIssues(cancelIssuesId);
    }
    return true;
  }

  getTransitionIdByStatus(status) {
    console.log("ticket status", status);
    status = status.toLowerCase();
    if (status === "scheduled") return "231";
    if (status === "acknowledged" || status === "at listing") return "241";
    if (status === "shoot complete") return "321";
    return false;
  }

  async cancelMultipleIssues(issueIdArray) {
    const cancelIssues = issueIdArray.map(
      async ({ id: issueId, transitionId }) => {
        return this.cancelIssueInJira(issueId, transitionId);
      }
    );

    return await Promise.all(cancelIssues);
  }

  async cancelIssueInJira(issueId, transitionId = "231") {
    const cancelPayload = {
      transition: {
        id: transitionId,
      },
    };

    return this.moveIssueInJira(issueId, cancelPayload);
  }

  /**
   * API can create issues upto 50, this function will be used
   * to crete multiple issues, in case of multiple product services
   *
   * @param {Object} issuesData - Issue data that is acceptable by Jira API
   * @returns {Object|null}
   */
  async createIssuesInJira(issuesData, retry = false) {
    if (issuesData.length > 50 || issuesData.length === 0) {
      console.log("Issues length mismatch", issuesData.length);
      return null;
    }

    try {
      const response = await this.axios.post("/issue/bulk", {
        issueUpdates: issuesData,
      });
      if (response.status >= 200 && response.status < 300) {
        const issueKeys = response.data.issues.map((issue) => issue.key);
        return issueKeys;
      }

      return false;
    } catch (error) {
      console.log("Error creating issue", error.response?.data ? JSON.stringify(error.response?.data) : error.message);
      if (error.response?.data?.errors && retry === false) {
        const errorsData = error.response.data.errors;
        return this.retryCreateWithoutReporter(errorsData, issuesData)
      }
  
      return false;
    }
  }

  checkReporterError(errorsData) {
    if(!errorsData || errorsData.length < 1) return false;
    const issueError = errorsData[0];
    if(issueError){
      const elementErrors = issueError.elementErrors.errors;
      if('reporter' in elementErrors){
        console.log('reporter error found');
        return true;
      }
    }
    return false
  }

  async retryCreateWithoutReporter(errorsData, issuesData) {
    const reporterError = this.checkReporterError(errorsData);
    if(reporterError) {
      console.log('retrying without reporter');
      const newIssuesData = issuesData.map((issueData) => {
        delete issueData.fields.reporter;
        return issueData;
      });
  
      return await this.createIssuesInJira(newIssuesData);
    }

    return false;
  }

  async retryUpdateWithoutReporter(errorsData, issueId, issueData) {
    const reporterError = this.checkReporterError(errorsData);
    if(reporterError) {
      console.log('retrying without reporter');
      delete issueData.fields.reporter;

      return await this.updateIssueInJira(issueId, issueData, true);
    }

    return false
  }

  /**
   *
   * @param {Array} existingIssues
   * @returns
   */
  async updateBulkIssues(existingIssues) {
    const updateIssues = existingIssues.map(async ({ issue, searchResult }) => {
      const issueId = searchResult.id;
      const response = await this.updateIssueInJira(issueId, issue);
      console.log("updateBulkIssues response status", JSON.stringify(response));
      return response;
    });

    const existingIssuesResponse = await Promise.all(updateIssues);
    return existingIssuesResponse;
  }

  /**
   *
   * @param {Object} issueData - Issue data that is acceptable by Jira API
   * @returns {Object|null}
   */
  async updateIssueInJira(issueId, issueData, retry = false) {
    try {
      const response = await this.axios.put(`/issue/${issueId}`, issueData);
      console.log("updateIssueInJira response status", response.status);
      if (response.status >= 200 && response.status < 300) return true;

      return false;
    } catch (error) {
      if (error.response?.data?.errors && retry === false) {
        const errorsData = error.response.data.errors;
        return this.retryUpdateWithoutReporter(errorsData, issueId, issueData)
      }
      const errorData = error.response?.data ? JSON.stringify(error.response?.data) : error.message;
      console.log(
        "Error updating issue",
        errorData
      );
      return false;
    }
  }

  async moveIssueInJira(issueId, issueData) {
    try {
      const response = await this.axios.post(
        `/issue/${issueId}/transitions`,
        issueData
      );

      console.log("moveIssueInJira response status", response.status);
      if (response.status >= 200 && response.status < 300) return true;

      return false;
    } catch (error) {
      console.log("Error in moveIssueInJira", error.message);
      return false;
    }
  }

  /**
   *
   * @param {Object} params
   * @returns
   */
  async searchJiraIssues(params, useJQLPath) {
    try {
      const baseURL = useJQLPath ? '/search/jql' : '/search';
      console.log('baseURL', baseURL);
      const response = await this.axios.get(baseURL, { params });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.log("Error in searchJiraIssues", errorData, error.message, JSON.stringify({params}));
      return false;
    }
  }

  /**
   *
   * @param {Object} issueData
   * @returns
   */
  createJQLSearchQuery(orderNumber, productName, maxResults = 1) {
    const params = {
      jql: `"NDPU Order Number[Short text]" ~ "${orderNumber}" AND "NDPU Service[Short text]" ~ "${productName}" AND status != Cancelled AND project = ${this.jiraStoreConfig.boardId}`,
      maxResults,
    };
    return params;
  }


  createJQLSearchQueryWithJiraIssueId(issueIds){
    const params = {
       jql: `key in (${issueIds})`,
    }
    console.log("params",params)
    return params;
  }

  createJQLRelaLink(orderNumber, maxResults = 1) {
    const params = {
      jql: `"NDPU Order Number[Short text]" ~ "${orderNumber}" AND "NDPU RelaHQ Upload Link" IS NOT EMPTY AND project = ${this.jiraStoreConfig.boardId}`,
      maxResults,
    }
    return params;
  }

  async getAllJiraIssue(orderNumber) {
    const query = this.createJQLSearchQuery(orderNumber, "IS NOT EMPTY", 50);
    console.log("JQL Query:", query);
    const searchResult = await this.searchJiraIssues(query, true);
  
    if (searchResult.total < 1 || !('issues' in searchResult)) {
      return {};
    }

    const jiraIssues = await this.searchIssuesInJiraById(searchResult?.issues);
    if (jiraIssues.length < 1) {
      return {};
    }
   
    return jiraIssues;
  }

  async formatDataFromAssignment(assignmentData) {
    try {
      const {
        id: assignmentId,
        accountId,
        photographer_email,
        start_date,
        customfield_10600,
        productName,
      } = assignmentData;

      const lastName = customfield_10600.split(" ").pop();
      const additionalData = {
        agent_last_name: lastName,
        shoot_date: start_date,
      };

      const formattedData = await this.formatRelaOrderData({
        ...assignmentData,
        ...additionalData,
      });
      const {
        property_address,
        shootDateInHours,
        shootDateInYYYYMMDD,
        encodedPropertyUrl,
        truncatedAgentLastName,
        truncatedPropertyStreet,
        summaryShootDateTime,
      } = formattedData;

      const truncatedProductName = productName.slice(0, 10);

      const issueData = {
        fields: {
          customfield_10603: property_address, // NDPU Listing Address
          customfield_10711: shootDateInHours, // NDPU Shoot Start Time
          customfield_12200: shootDateInYYYYMMDD, // NDPU Shoot Date
          customfield_11400: encodedPropertyUrl, // NDPU Google Map Link
          customfield_11900: assignmentId, // NDPU Appointment Number
          assignee: {
            id: accountId,
          },
          summary: `${summaryShootDateTime} ${truncatedAgentLastName} ${truncatedPropertyStreet} ${truncatedProductName}`,
        },
        update: {},
      };

      if (this.jiraStoreConfig.jiraInstance === 1) {
        issueData.fields.customfield_12642 = photographer_email; // NDPU MediaPro ID
      } else {
        issueData.fields.customfield_12646 = photographer_email; // NDPU MediaPro ID
      }

      console.log("accountId: ", accountId);
      return issueData;
    } catch (error) {
      console.log("error formatting assignment data: ", error.message);
      return false;
    }
  }

  async getJiraIssueByOrder(orderId, productName) {
    try {
        const query = this.createJQLSearchQuery(orderId, productName);
        const searchResult = await this.searchJiraIssues(query, true);
        if (searchResult.total < 1 || !('issues' in searchResult)) {
          return {};
        }

        const jiraIssues = await this.searchIssuesInJiraById(searchResult?.issues);
        if (jiraIssues.length < 1) {
          return {};
        }
        return jiraIssues.issues[0];
    } catch (error) {
      console.log('Error getting jira issue by order', JSON.stringify(error?.response?.data));
    }
  }

  async searchIssuesInJiraById(issueIds){
    try{
      const ids = issueIds.map(item =>Number(item.id));
      if(ids.length < 1){
        return [];
      }
      const query = this.createJQLSearchQueryWithJiraIssueId(ids);
      const searchResult = await this.searchJiraIssues(query);
      if (searchResult.total < 1 || !('issues' in searchResult)) {
        return [];
      }

      return searchResult;
    }catch(err){
      console.log('Error getting jira issues by id', JSON.stringify(err?.response?.data));
    }
  }

  handleInvalidStringArray(stringArray) {
    try {
      let singleQuoteString = stringArray.replace(/'/g, '"');
      singleQuoteString = singleQuoteString.replace(/False/g, "false");
      singleQuoteString = singleQuoteString.replace(/True/g, "true");
      singleQuoteString = singleQuoteString.replace(/None/g, "null");
      const parsedArray = JSON.parse(singleQuoteString);
      return parsedArray;
    } catch (e) {
      console.log("handleInvalidStringArray", e.message);
      return [];
    }
  }

  async handleAssignmentCreatedOrUpdated(assignmentData) {
    try {
      const { photographer_email, products_list, order_id, status } =
        assignmentData;
      console.log(
        `Photographer: ${photographer_email}, Assignment: ${status}, Order: ${order_id}`
      );

      if (
        status === "cancelled" ||
        status === "canceled" ||
        status === "deleted"
      ) {
        return this.handleAssignmentCancelledOrDeleted(assignmentData);
      }

      const { accountId } = await this.findJiraUserByEmail(photographer_email);

      const updateJiraIssues = products_list.map(async (product) => {
        const { name } = product;
        const { id: issueId, fields } = await this.getJiraIssueByOrder(
          order_id,
          name
        );

        if(!fields) { // meaning there are no issues for this product
          console.log('Issue not found ', order_id ,name);
          return false;
        }

        const { customfield_10600 } = fields;

        const issueData = await this.formatDataFromAssignment({
          ...assignmentData,
          accountId,
          customfield_10600,
          productName: name,
        });

        return this.updateIssueInJira(issueId, issueData);
      });

      if(updateJiraIssues.filter(Boolean).length === 0) {
        return updateJiraIssues;
      }

      const updateJiraIssuesResponse = await Promise.all(updateJiraIssues);
      console.log("updateJiraIssuesResponse", JSON.stringify(updateJiraIssuesResponse));

      return updateJiraIssuesResponse;
    } catch (err) {
      console.log("error handleAssignmentCreated", err.message);
      return [false];
    }
  }

  async handleAssignmentCancelledOrDeleted(assignmentData) {
    try {
      const { products_list, order_id } = assignmentData;

      for (let product of products_list) {
        const { name } = product;
        if (name && order_id) {
          const issueByOrder = await this.getJiraIssueByOrder(order_id, name);
          if (issueByOrder && issueByOrder.id) {
            const { id } = issueByOrder;
            const updatePayload = {
              fields: {
                assignee: {
                  id: null,
                },
                customfield_11900: null, // NDPU Appointment Number

              }
            };

            if (this.jiraStoreConfig.jiraInstance === 1) {    ``
              updatePayload.fields.customfield_12642 = null; // NDPU MediaPro ID
            } else {
              updatePayload.fields.customfield_12646 = null; // NDPU MediaPro ID
            }
          
            await this.updateIssueInJira(id, updatePayload);
          }
        }
      }
    } catch (err) {
      console.log("error handleAssignmentCancelled", err.message);
      return false;
    }
  }

  async findJiraUserByEmail(email) {
    try {
      const response = await this.axios.get("user/search", {
        params: {
          query: email,
        },
      });

      const users = response.data;

      if (users && users.length > 0) {
        return users[0];
      }

      console.log("User not found in Jira: ", email);
      return false; // User not found
    } catch (error) {
      console.log("error while serching user in jira", error.message);
      return null;
    }
  }

  /**
   *
   * @param {Object} issueData
   * @returns
   */
  async separateNewAndExistingIssues(issueData) {
    const newIssues = [];
    const existingIssues = [];
    const removedIssues = [];

    const orderNumber = issueData[0].fields.customfield_10501;

    // get all the issues in the Jira for the order
    const allIssues = await this.getAllJiraIssue(orderNumber);

    console.log("Total issues in Jira: ", allIssues.total);

    const { issues: jiraIssues } = allIssues;

    // Create Set for faster lookups
    const allJiraIssuesSet = new Set(
      jiraIssues.map((issue) => issue.fields.customfield_11104)
    );

    console.log("Issue data length:  ", issueData.length);
    console.log("Issues in Jira", allJiraIssuesSet);

    // loop through products in Rela response
    for (const product of issueData) {
      const productName = product.fields.customfield_11104;

      // check if that product is already created in Jira
      if (allJiraIssuesSet.has(productName)) {
        const searchResult = jiraIssues.find(
          (issue) => productName === issue.fields.customfield_11104
        );
        // don't update the booking date if it exists
        if (searchResult && searchResult.fields?.customfield_10614) {
          delete product.fields?.customfield_10614;
        }

        existingIssues.push({ issue: product, searchResult });

        allJiraIssuesSet.delete(productName); // by doing this, set will only contain issues that are not in Rela
      } else {
        newIssues.push(product);
      }
    }

    console.log("Issues to create: ", newIssues.length);
    console.log("Issues to update: ", existingIssues.length);
    console.log("Issues to remove: ", allJiraIssuesSet);
    // loop through all the Jira issues and
    for (const issue of jiraIssues) {
      if (
        allJiraIssuesSet.has(issue.fields.customfield_11104) &&
        issue &&
        issue.id
      ) {
        const { id, fields } = issue;
        const status = fields?.status?.name;
        const transitionId = this.getTransitionIdByStatus(status);
        if (transitionId) {
          removedIssues.push({ id, transitionId });
        }
      }
    }

    return { existingIssues, newIssues, removedIssues };
  }

  /**
   * Function that handles raw order data
   * and convert it into valid Jira issue object
   *
   * @param {Object} rawOrderData
   * @returns {Object}
   */
  async generateIssueDataFromRelaOrder(rawOrderData) {
    try {
      const formattedOrderData = await this.formatRelaOrderData(rawOrderData);
      const issueData = this.createIssueBody(formattedOrderData);

      return issueData;
    } catch (err) {
      console.log("error while generating issue data from rela order", err.message);
      return false;
    }
  }

  /**
   * this function will process the raw order and
   * make it suitable for Jira issue by changing data format
   * or combine/remove certain fields.
   *
   * @param {Object} rawOrderData - raw response from Rela forwarded by Zapier
   * @returns {Object}
   */
  async formatRelaOrderData(rawOrderData) {
    const {
      products_list,
      shoot_date,
      agent_last_name,
      property_street,
      property_address,
      order_notes,
      service_intake_questions,
      raw_booking_date,
      agent_email,
      assignments = []
    } = rawOrderData;

    const prefData = await getPrefDataFromJSONFile();

    const formattedOrderData = {
      finalProducts: [],
      orderNotesBody: [],
      shootDateInYYYYMMDD: "",
      shootDateInHours: "",
      truncatedAgentLastName: "",
      truncatedPropertyStreet: "",
      encodedPropertyUrl: "",
    };

    if(assignments.length > 0 ){
      formattedOrderData.productAssignmentMap = this.createMapForProductAssignments(assignments);
    }

    let serviceIntakeQuestions = {};

    if (Array.isArray(service_intake_questions)) {
      serviceIntakeQuestions = this.formatServiceIntakeQuestions(
        service_intake_questions
      );
    }

    if (Array.isArray(products_list)) {
      formattedOrderData.finalProducts = this.formatFinalProductList(
        products_list,
        serviceIntakeQuestions
      );
    }

    if(agent_email) {
      const lowerAgentEmail = agent_email.toLowerCase();
      if (lowerAgentEmail in prefData) {
        formattedOrderData.notesForEditor = this.formatNotesForEditor(
          prefData[lowerAgentEmail]
        );
      }
    }

    if (Array.isArray(order_notes)) {
      formattedOrderData.orderNotesBody = this.formatOrderNotes(order_notes);
    }

    if (typeof shoot_date === "string" && shoot_date.length > 0) {
      const {summaryShootDateTime, shootDateInYYYYMMDD, shootDateInHours} = this.getTimeFormats(shoot_date);

      formattedOrderData.summaryShootDateTime = summaryShootDateTime;
      formattedOrderData.shootDateInYYYYMMDD = shootDateInYYYYMMDD;
      formattedOrderData.shootDateInHours = shootDateInHours;
    }

    if (raw_booking_date) {
      formattedOrderData.final_booking_date = formatDate(
        raw_booking_date,
        "yyyy-MM-dd",
        this.jiraStoreConfig.timeZone
      );
    }

    if (typeof agent_last_name === "string" && agent_last_name.length > 0) {
      formattedOrderData.truncatedAgentLastName = agent_last_name.slice(0, 10);
    }

    if (typeof property_street === "string" && property_street.length > 0) {
      formattedOrderData.truncatedPropertyStreet = property_street.slice(0, 15);
    }

    if (typeof property_address === "string" && property_address.length > 0) {
      const encodedPropertyAddress = encodeURIComponent(property_address);
      formattedOrderData.encodedPropertyUrl = `http://maps.google.com/?q=${encodedPropertyAddress}`;
    }

    return { ...rawOrderData, ...formattedOrderData };
  }

  createMapForProductAssignments(assignments){
    const productAssignmentMap = new Map();
    for (const assignment of assignments) {
      const timeFormats  = this.getTimeFormats(assignment.start_date); // format data based on the assignment start date

      const products = assignment.products_list;
      // loop through product list and assign the formatted time
      for (let i=0; i<products.length; i++) {
        const product = products[i];
        if (!productAssignmentMap.has(product.product_id)) {
          productAssignmentMap.set(product.product_id, timeFormats);
        }
      }
    }

    return productAssignmentMap;
  }

  getTimeFormats(shootDate) {
    const summaryShootDateTime = formatDate(
      shootDate,
      "yyMMdd hh.mm a",
      this.jiraStoreConfig.timeZone
    );
    const shootDateInYYYYMMDD = formatDate(
      shootDate,
      "yyyy-MM-dd",
      this.jiraStoreConfig.timeZone
    );
    const shootDateInHours = formatDate(
      shootDate,
      "h:mm a",
      this.jiraStoreConfig.timeZone
    );

    return {summaryShootDateTime, shootDateInYYYYMMDD, shootDateInHours};
  }

  /**
   * Function to convert the raw intake questions data
   * to Jira document format and also groups the intake
   * questions by product id
   *
   * @param {Array} rawServiceIntakeQuestions
   * @returns {Object}
   */
  formatServiceIntakeQuestions(rawServiceIntakeQuestions) {
    const serviceIntakeQuestions = {};

    rawServiceIntakeQuestions.forEach((intakeData) => {
      const { product_id, question, answer } = intakeData;

      const QnAFormat = {
        content: [
          {
            text: `Question: ${question}`,
            type: "text",
          },
          {
            type: "hardBreak",
          },
          {
            text: `Answer: ${answer}`,
            type: "text",
          },
        ],
        type: "paragraph",
      };

      const serviceIntakeQuestionsDoc = [
          {
            ...QnAFormat,
          },
        ];

      if (product_id in serviceIntakeQuestions) {
        serviceIntakeQuestions[product_id].push({ ...QnAFormat });
      } else {
        serviceIntakeQuestions[product_id] = serviceIntakeQuestionsDoc;
      }
    });

    return serviceIntakeQuestions;
  }

  /**
   * This function accepts the products list data
   * from Rela response and formatted service intake questions
   * it returns array of product objects with their respective
   * intake questions
   *
   * @param {Array} productsList
   * @param {Object} serviceIntakeQuestions
   * @returns {Array}
   */
  formatFinalProductList(productsList, serviceIntakeQuestions) {
    const finalProducts = [];
    productsList.forEach((product) => {
      const { product_id, name, variation, isEssentialsPackage } = product;

      finalProducts.push({
        name,
        product_id,
        variation,
        isEssentialsPackage,
        serviceIntakeQuestions: serviceIntakeQuestions[product_id],
      });
    });

    return finalProducts;
  }

  /**
   * This function accepts the order notes data
   * from Rela response and format it into
   * Jira acceptable Document format
   *
   * @param {Array} rawOrderNotes
   * @returns {Object}
   */
  formatOrderNotes(rawOrderNotes) {
    const notesBodyArray = [];

    rawOrderNotes.forEach((note) => {
      notesBodyArray.push({
        text: note.body,
        type: "text",
      });
      notesBodyArray.push({
        type: "hardBreak",
      });
    });

    const orderNotesDoc = {
      content: [
        {
          type: "paragraph",
          content: notesBodyArray,
        },
      ],
      type: "doc",
      version: 1,
    };

    return orderNotesDoc;
  }

  formatNotesForEditor(prefData) {
    const {
      customer_shoot_pref,
      customer_editing_pref,
      customer_delivery_pref,
    } = prefData;

    const editingArray = [
      {
        text: "Client Editing Preference:",
        type: "text",
        marks: [
          {
            type: "strong"
          }
        ]
      },
      {
        type: "hardBreak",
      },
      {
        text: customer_editing_pref,
        type: "text",
      },
    ];

    const shootingArray = [
      {
        text: "Client Shooting Preference:",
        type: "text",
        marks: [
          {
            type: "strong"
          }
        ]
      },
      {
        type: "hardBreak",
      },
      {
        text: customer_shoot_pref,
        type: "text",
      },
    ];

    const deliveryArray = [
      {
        text: "Client Delivery Preference:",
        type: "text",
        marks: [
          {
            type: "strong"
          }
        ]
      },
      {
        type: "hardBreak",
      },
      {
        text: customer_delivery_pref,
        type: "text",
      },
    ];

    const content = [];
    if(customer_editing_pref) {
      content.push({
        type: "paragraph",
        content: editingArray,
      });
    }
    if(customer_shoot_pref) {
      content.push({
        type: "paragraph",
        content: shootingArray,
      });
    }
    if(customer_delivery_pref) {
      content.push({
        type: "paragraph",
        content: deliveryArray,
      });
    }

    const prefNotesDoc = {
      content,
      type: "doc",
      version: 1,
    };

    return prefNotesDoc;
  }

  /**
   * this function will map the Rela response to the Jira fields
   * Jira accepts `customfield_####`, for refrence look at "fields.js" file
   *
   * @param {Object} formattedOrderData
   * @returns {Object}
   */
  createIssueBody(formattedOrderData) {
    const issuesData = [];

    // common fields for all issues
    const commonCustomFieldObject = {
      project: {
        id: this.jiraStoreConfig.boardId,
      },
      issuetype: {
        id: "10500",
      },
      customfield_10501: formattedOrderData.id, // NDPU Order Number
      customfield_10600: formattedOrderData.agent_name, // NDPU Client Name
      customfield_10601: formattedOrderData.agent_email, // NDPU Client Email
      customfield_10602: formattedOrderData.agent_phone, // NDPU Client Cell No.
      customfield_10603: formattedOrderData.property_address, // NDPU Listing Address
      customfield_10610: formattedOrderData.property_sqft_range, // NDPU Square Footage
      customfield_10614: formattedOrderData.final_booking_date, // NDPU Booking Date
      customfield_11400: formattedOrderData.encodedPropertyUrl, // NDPU Google Map Link
    };

    if(this.jiraStoreConfig.reporterId && this.eventType === 'create') {
      commonCustomFieldObject.reporter = {
        id: this.jiraStoreConfig.reporterId,
      };
    }

    if (this.jiraStoreConfig.jiraInstance === 1) {
      commonCustomFieldObject.customfield_12595 = formattedOrderData.orderNotesBody; // NDPU Special Instructions
      commonCustomFieldObject.customfield_12644 =  this.jiraStoreConfig.editingTeam; // NDPU Editing Team
    } else {
      commonCustomFieldObject.customfield_12612 = formattedOrderData.orderNotesBody; // NDPU Special Instructions
      commonCustomFieldObject.customfield_12648= this.jiraStoreConfig.editingTeam; // NDPU Editing Team
    }

    if (formattedOrderData.notesForEditor) {
      commonCustomFieldObject.customfield_11601 =
        formattedOrderData.notesForEditor;
    }

    const {
      finalProducts,
      truncatedAgentLastName,
      truncatedPropertyStreet,
      productAssignmentMap,
    } = formattedOrderData;
    console.log('productAssignmentMap', JSON.stringify(productAssignmentMap));

    const isSameDay =
      finalProducts &&
      finalProducts[0] &&
      finalProducts[0].name.includes("Same Day");

    // loop through each product and create issue object
    for (let i = 0; i < finalProducts.length; i++) {
      const product = finalProducts[i];
      const productId = product.product_id;

      let { summaryShootDateTime, shootDateInHours, shootDateInYYYYMMDD } = formattedOrderData;
      
      if(productAssignmentMap && productAssignmentMap.has(productId)){
        const productAssignment = productAssignmentMap.get(productId);
        summaryShootDateTime = productAssignment.summaryShootDateTime;
        shootDateInHours = productAssignment.shootDateInHours;
        shootDateInYYYYMMDD = productAssignment.shootDateInYYYYMMDD;
      }

      const { name: productName, serviceIntakeQuestions, variation, isEssentialsPackage } = product;
      const truncatedProductName = productName.slice(0, 10);

      const issueObject = {
        customfield_11104: productName, // NDPU Service
        summary: `${summaryShootDateTime} ${truncatedAgentLastName} ${truncatedPropertyStreet} ${truncatedProductName}`,
        customfield_10711: shootDateInHours, // NDPU Shoot Start Time
        customfield_12200: shootDateInYYYYMMDD, // NDPU Shoot Date
        ...commonCustomFieldObject,
      };

      if (isEssentialsPackage) {
        const content = [{
          type: "paragraph",
          content: [{
              text: "L.O. Editing Preferences:",
              type: "text",
            },
            {
              type: "hardBreak",
            },
            {
              text: "This is an NDP Essential Order. We have removed the 1 Twilight Jira card but please make sure we edit and deliver the 1 Twilght - Day to Dusk conversion photo.",
              type: "text",
            }
          ],
        }];
        
        if('customfield_11601' in issueObject) {
          const finalNotes = JSON.parse(JSON.stringify(issueObject.customfield_11601));
          finalNotes.content.unshift(...content);
          issueObject.customfield_11601 = finalNotes;
        } else {
          issueObject.customfield_11601 = {
            content,
            type: "doc",
            version: 1,
          }
        }
      }

      // append service intake questions to notes to editors
      if (serviceIntakeQuestions) {
        if ("customfield_11601" in issueObject) {
          const finalNotes = JSON.parse(
            JSON.stringify(issueObject.customfield_11601)
          );
          finalNotes.content.push(...serviceIntakeQuestions);
          issueObject.customfield_11601 = finalNotes;
        } else {
          issueObject.customfield_11601 = {
            content: serviceIntakeQuestions,
            type: "doc",
            version: 1,
          };
        }
      }

      if (this.jiraStoreConfig.jiraInstance === 1) {
        issueObject.customfield_12594 = serviceIntakeQuestions; // NDPU Access Instructions
        if (variation) issueObject.customfield_12698 = variation; // NDPU Number of Expected Output
      } else {
        issueObject.customfield_12611 = serviceIntakeQuestions; // NDPU Access Instructions
        if (variation) issueObject.customfield_12713 = variation; // NDPU Number of Expected Output
      }

      if (isSameDay) {
        issueObject.customfield_12573 = "Yes";
        issueObject.priority = {
          name: "High",
        };
      }

      issuesData.push({ fields: issueObject, update: {} });
    }

    return issuesData;
  }

  /**
   * This function triggers when an issue is moved from one column to another.
   * @param {Object} data - Jira Data.
   * @returns {void}
   */
  async issueMoved(data = {}) {
    try {
      if (!Object.keys(data).length) return null;

      const movedFrom = this.getIssueMovedData(data.changelog);
      if (!movedFrom) return null;
      console.log(`Changelog ${new Date()}` , JSON.stringify(data.changelog));

      const { fromString, toString } = movedFrom;
      const issueMovedTo = this.getIssueMovedTo(fromString, toString);

      console.log(`Issue moved from ${fromString} to ${toString}`);
      console.log("ISSUE MOVED TO", issueMovedTo);

      if (issueMovedTo === "LISTING") {
        return await this.handleListing(data);
      } else if (issueMovedTo === "SHOOT COMPLETE") {
        return await this.handleShootComplete(data);
      } else if(issueMovedTo === "UPLOADED") {
        return await this.handleShootComplete(data);
      }else if (issueMovedTo === "FINAL REVIEW") {
        return await this.handleFinalReview(data);
      }

      return null;
    } catch (err) {
      console.error("Error handling issue move:", err.message);
      return false;
    }
  }

  /**
   * initial request from NDP team was to create only the rela link
   * when an issue is moved automatically
   * @param {Object} data 
   * @returns {Boolean || undefined}
   */
  async handleUploaded(data) {
    try {
      const issueFields = data?.issue?.fields || {};
      const issueKey = data?.issue?.key;
      const field =
        this.jiraStoreConfig.jiraInstance === 1
          ? "customfield_12688"   // NDPU RelaHQ Upload Link  (Instance 1)
          : "customfield_12700";  // NDPU RelaHQ Upload Link  (Instance 2)

      const link = await this.handleRelaPropertyLink(issueFields, field, issueKey, false);
      console.log(`Rela Property Link for uploaded : ${link}`);
    } catch (err) {
      console.error("Error handling uploaded:", err.message);
      return false;
    }
  }

  async handleListing(data) {
    try {
      // Only continue if floorplan product
      const customfield_11104 = data?.issue?.fields?.customfield_11104;
      const productType = customfield_11104?.toLowerCase();
      const isFloorplan =
        productType.includes("floorplan") ||
        productType.includes("floor plan") ||
        productType.includes("zillow");

      if (isFloorplan && productType.includes("home measurement") === false) {
        const cubicasaInstance = new Cubicasa();
        const draftOrder = await cubicasaInstance.createDraftOrder(
          data,
          this.jiraStoreConfig.jiraInstance
        );

        return draftOrder;
      }

      return null;
    } catch (err) {
      console.error("Error creating draft order:", err.message);
      return false;
    }
  }

  async handleFinalReview(data) {
    try {
      const issueFields = data?.issue?.fields || {};

      // NDPU RelaHQ Upload Link
      let relaPropertyUrl =
        this.jiraStoreConfig.jiraInstance === 1
          ? issueFields.customfield_12688
          : issueFields.customfield_12700;

      if (!relaPropertyUrl) {
        console.log("Rela Property Url is missing for", data?.issue?.key);
        return true;
      }

      /*
       For some reason, Jira was sending same request multiple times
       This is a workaround to prevent multiple uploads
      */
      const changelogId = data.changelog?.id; // unique id from Jira
      const dateInISO = (new Date()).toISOString();
      const formattedDate = formatDate(dateInISO, "yyyy-MM-dd"); // current date to reject the identical requests for the same day

      const key = `uploaded-${formattedDate}-${changelogId}`;
      const ifUploaded = await redisclient.get(key);
      if (ifUploaded){
        console.log(`Already uploaded images to ${relaPropertyUrl} with key ${key}`);
        return true;
      } // workaround completed

      // get the download links from the dropbox
      const dropboxInstance = new Dropbox(this.jiraStoreConfig.dropboxInstance);
      await dropboxInstance.init();
      console.log('Getting links from DB URL')
      const imageLinks = await dropboxInstance.fetchFilesFromUrl(issueFields?.customfield_10714);
      console.log('imageLinks length', imageLinks.length);

      const relaInstance = new Rela();
      // extract property id from url
      const url = new URL(relaPropertyUrl);
      const pathSegments = url.pathname.split("/");
      const propertyId = pathSegments[3];

      return await relaInstance.uploadImagesToRela(imageLinks, propertyId, key); // upload images to rela property

    } catch (err) {
      console.error("Error in handling final review",err.message);
      return false;
    }
  }

  async handleShootComplete(data) {
    const issueFields = data?.issue?.fields || {};
    const issueKey = data?.issue?.key;
    const field =
      this.jiraStoreConfig.jiraInstance === 1
        ? "customfield_12688"   // NDPU RelaHQ Upload Link  (Instance 1)
        : "customfield_12700";  // NDPU RelaHQ Upload Link  (Instance 2)
    try {
      const link = await this.handleRelaPropertyLink(issueFields, field, issueKey);
      console.log(`Rela Property Link ${issueKey}: ${link}`);
      const dropboxLink = await this.handleDropBoxLink(issueFields, issueKey);
      console.log(`Dropbox Link ${issueKey}: ${dropboxLink}`);

      if(dropboxLink === false) {
        throw new Error("Dropbox Link Failed");
      }
    } catch (err) {
      console.error("Error handling shoot complete:", err.message);
      return false;
    }
  }


  /**
   * This function fetches or creates rela agent
   * Then creates new rela property and updates the issue with the link
   * @param {Object} issueFields - Fields of the issue
   * @param {string} field - Field name to update
   * @param {string} issueKey - Issue key
   * @returns {Promise<void | null>}
   */
  async handleRelaPropertyLink(issueFields, field, issueKey, createNew = true) {
    try {
      let link = await this.getExistingRelaLink(issueFields, field);

      if (!link && createNew === true) {
        link = await this.createRelaLink(issueFields);
        console.log('creating new rela link for issue', issueKey);
      }
      console.log(`Rela Property Link: ${link}`);
      if (link) {
        await this.updateJiraCustomField(issueKey, {
          fields: {
            [field]: link,
          },
        });
      }
    } catch (err) {
      console.error("Error in handling rela property link:", err.message);
    }
  }



  /**
   * This function fetches existing rela property link if it exists in Jira
   * @param {Object} issueFields - Fields of the issue
   * @param {string} field - Field name to update
   * @returns {Promise<string|void>} - Existing link or void if an error occurs
   */

  async getExistingRelaLink(issueFields, field) {
    try {
      let link = issueFields[field];
      if (link) {
        console.log(`Link already exists: ${link}`);
        return link;
      }
      const orderNumber = issueFields.customfield_10501;  // NDPU Order Number
      const params = this.createJQLRelaLink(orderNumber);
      console.log("params: ",params);
      const searchJiraIssuesResponse = await this.searchJiraIssues(params);

      if (searchJiraIssuesResponse && searchJiraIssuesResponse?.issues?.length > 0) {
        const issue = searchJiraIssuesResponse?.issues[0];
        link = issue?.fields[field];
        console.log('existing link', link);
      }

      return link;
    } catch (err) {
      console.error("Error in getting existing rela link:", err.message);
    }
  }


  /**
   * This function creates rela property link if it doesn't exist in Jira
   * @param {Object} issueFields - Fields of the issue
   * @returns {Promise<string|void>} - Newly created link or void if an error occurs
   */

  async createRelaLink(issueFields) {
    try{
      let link = '';
      const relaInstance = new Rela();
      const relaAgent = await relaInstance.fetchOrCreateRelaAgent(issueFields);
      const order_id = issueFields.customfield_10501;  // NDPU Order Number
      if(!order_id){
        console.log("Order ID is missing");
        return false;
      }
      const encodedUri = encodeURIComponent(
        issueFields.customfield_10603.replace(/ /g, "+")
      );
      const addressData = await getGeocodeData(encodedUri);
      if (addressData) {
        link = await relaInstance.getNewPropertyLink(
          relaAgent,
          addressData,
          order_id
        );
      }
      return link;
    }catch(err){
      console.error("Error in creating rela link:", err.message);
    }
  }


  /**
   * This function creates a folder in dropbox based on the product name and category
   * and saves the link to the custom field in Jira.
   * @param {Object} issueFields - The fields of the issue which are fetched
   * from Jira.
   * @param {string} issueKey - The key of the issue which is used to update
   * the custom field in Jira.
   * @returns {Promise<void|boolean>} - A promise which resolves to void if the
   * operation is successful or false if it's not.
   */
  async handleDropBoxLink(issueFields, issueKey) {
    if (issueFields?.customfield_12543 === "No") { // NDPU Folder Created
      const dropboxInstance = new Dropbox(this.jiraStoreConfig.dropboxInstance);
      // set headers in dropbox http request broker
      await dropboxInstance.init();
      const category = this.categorizeService(issueFields?.customfield_11104);
      const paths = await dropboxInstance.createFolderInDropbox({
        name: issueFields?.project?.name,
        category,
        customfield_12006: issueFields?.customfield_12006,
        summary: issueFields?.summary,
      });
      if (!paths) {
        console.error("Error creating folders in dropbox");
        return false;
      }
      // Saving those paths to jira
      // Raw Media Folder customfield_10713
      // Edited Media Folder customfield_10713
      const payload = {};
      for (let path of paths) {
        const { pathDisplay, link } = path;
        if (pathDisplay.includes("Media Inbox")) {
          payload.customfield_10713 = link;
        } else if (pathDisplay.includes("Completed Media")) {
          payload.customfield_10714 = link;
        }
      }

      if(Object.keys(payload).length > 0) {
        payload.customfield_12543 = "Yes";
        await this.updateJiraCustomField(issueKey, {
          fields: payload,
        });
      }

      return true;
    }
    console.log('Folder created already for: ', issueKey);
    return true
  }

  /**
   * This function returns category name, from jira data
   * @param {*} inputData
   * @returns { string }
   */
  categorizeService(inputData) {
    // Check if specific services exist in the input data
    let flagAerial = inputData.indexOf("Aerial") !== -1;
    let flagVideo = inputData.indexOf("Video") !== -1;
    let flag3D = inputData.indexOf("3-D Model") !== -1;
    let flagFloorplan = inputData.indexOf("Floor Plan") !== -1;
    // let flagPhoto = inputData.indexOf("Photo") !== -1;
    // Initialize category as undefined
    let category;
    // Determine the category based on the flags
    if (flagAerial) {
      category = "Aerials";
    } else if (flag3D) {
      category = "3D Models";
    } else if (flagFloorplan) {
      category = "Floor Plans";
    } else if (flagVideo && !flagAerial) {
      category = "Listing Videos";
    } else if (!flagVideo && !flagAerial && !flagFloorplan && !flag3D) {
      category = "Photos";
    }
    // Return the category as string
    return category;
  }

  /**
   * Updates a custom field in a Jira issue
   * @param {string} issueId - The ID of the Jira issue to update
   * @param {Object} data - The data to update in the custom field
   * @returns {boolean} - Whether the update was successful
   */
  async updateJiraCustomField(issueId, data) {
    try {
      // Make a PUT request to the Jira API to update the specified field with the provided data
      const response = await this.axios.put(`/issue/${issueId}`, data);

      // Log the response data for confirmation
      console.log("Field updated",JSON.stringify(response.data));
      return true;
    } catch (err) {
      // Log an error message if the update fails
      console.error("Error updating Jira custom field", JSON.stringify(err));
      return false;
    }
  }

  /**
   * This function returns the status an issue moved to based on the from and to statuses
   * @param {string} from - The initial status
   * @param {string} to - The final status
   * @returns {string} - The new status
   */
  getIssueMovedTo(from, to) {
    if (from === "ACKNOWLEDGED" && to === "AT LISTING") {
      return "LISTING";
    } else if (from === "AT LISTING" && to === "SHOOT COMPLETE") {
      return "SHOOT COMPLETE";
    } else if (to === "FINAL REVIEW") {
      return "FINAL REVIEW";
    } else if(from === "SCHEDULED" && to === "UPLOADED") {
      return "UPLOADED";
    }

    return "";
  }

  /**
   * This function extracts and returns data about issue movement (from and to statuses) from the changelog
   * @param {Object} changelog - Jira changelog data
   * @returns {Object | null} - An object containing fromString and toString, or null if not found
   */
  getIssueMovedData(changelog = {}) {
    const issueStatuses = [
      "at listing",
      "acknowledged",
      "shoot complete",
      "final review",
      "edit",
      "uploaded",
      "scheduled",
    ];
    if (changelog?.items) {
      for (const item of changelog.items) {
        const isFromTrue = issueStatuses.includes(
          item.fromString?.toLowerCase()
        );
        const isToTrue = issueStatuses.includes(item.toString?.toLowerCase());
        if (isFromTrue && isToTrue) {
          return {
            fromString: item.fromString.toUpperCase(),
            toString: item.toString.toUpperCase(),
          };
        }
      }
    }
    return null;
  }

  async linkAllOrderIssue(issueKeys) {
    try {
      // get All Issues for the order
      // const issues = await this.getJiraIssueByOrder(orderId);
      const linkType = "Package Add-on";
      console.log("linkallOrder : ", issueKeys);
      if (issueKeys.length < 2) {
        console.log(`Not enough issue to link`);
        return true;
      }
      // ! This function would make multiple calls based on the number of issues
      for (let i = 0; i < issueKeys.length - 1; i++) {
        for (let j = i + 1; j < issueKeys.length; j++) {
          const inwardIssueKey = issueKeys[i];
          const outwardIssueKey = issueKeys[j];

          const response = await this.linkOrderIssue(
            inwardIssueKey,
            outwardIssueKey,
            linkType
          );

          if (response.status >= 200 && response.status < 300) {
            console.log(`Linked ${inwardIssueKey} to ${outwardIssueKey}`);
          } else {
            console.error(
              `Failed to link ${inwardIssueKey} to ${outwardIssueKey}`
            );
          }
        }
      }
      return true;
    } catch (err) {
      console.log(`Error linking issues`, err.message);
      return false;
    }
  }
  async linkOrderIssue(inwardIssueKey, outwardIssueKey, linkType) {
    try {
      const response = await this.axios.post("/issueLink", {
        type: {
          name: linkType,
        },
        inwardIssue: {
          key: inwardIssueKey,
        },
        outwardIssue: {
          key: outwardIssueKey,
        },
      });
      return response;
    } catch (err) {
      console.log(`Error linking ${inwardIssueKey} to ${outwardIssueKey}`, err.message);
      throw err;
    }
  }
}

export default Jira;
