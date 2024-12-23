"use client";

import { Button } from "@/components/ui/button";
import Heading from "@/components/ui/heading";
import { Separator } from "@/components/ui/separator";
import { Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { CategoryColumn, columns } from "./columns";
import { DataTable } from "@/components/ui/data-table";
import { ApiList } from "@/components/ui/api-list";
import { useEffect } from "react";

interface CategoriesClientProps{
  data: CategoryColumn[]
}

const CategoryClient:React.FC<CategoriesClientProps> = ({
  data
}) => {

    const router = useRouter();
    const params = useParams();

    useEffect(()=>{
       router.refresh();
    },[]);

    return (
        <>
        <div className="flex items-center justify-between">
           <Heading title={`Categories (${data.length})`} description="Manage categories for your store" />
           <Button onClick={()=>{router.push(`/${params.storeId}/categories/new`)}}>
             <Plus className="mr-2 h-4 w-4" />
             Add New
           </Button>
        </div>
        <Separator/>
        <DataTable columns={columns} data={data} searchKey="name" />
        <Heading title="API" description="API calls for Categories"  />
        <ApiList entityName="categories" entityIdName="categoriesId" />
        </>
    );
};

export default CategoryClient;