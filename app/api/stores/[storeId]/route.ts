import prismadb from "@/lib/prismadb";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function PATCH(
 req:Request,
 {params}:{params:{storeId:string}}
){
    try{
        console.log('here')
        const { userId } = auth();
        const body = await req.json();
        const {name} = body;

        if(!userId){
            return new NextResponse('Unauthorized', { status: 401 });
        }

        if(!name){
            return new NextResponse('Name is Required', { status: 400 });
        }

        if(!params.storeId){
            return new NextResponse('Store id is Required', { status: 400 });
        }

        const store = await prismadb.store.updateMany({
            where:{
                id: params.storeId,
                userId,
            },
            data:{
                name,
            }
        });
         
        return NextResponse.json(store);

    }catch(err){
        console.log('[STORES_PATCH]', err);
        return new NextResponse("Internal error", {status:500});
    }
};

export async function DELETE(
    req:Request,
    {params}:{params:{storeId:string}}
   ){
       try{
   
           const { userId } = auth();
           
           if(!userId){
               return new NextResponse('Unauthorized', { status: 401 });
           }
           
           const {storeId} = params;

           if(!storeId){
               return new NextResponse('Store id is Required', { status: 400 });
           }
   
           const store = await prismadb.store.deleteMany({
               where:{
                   id: storeId,
                   userId,
               },
           });
            
           return NextResponse.json(store);
   
       }catch(err){
           console.log('[STORES_DELETE]');
           console.log('[STORES_DELETE]', err);
           return new NextResponse("Internal error", {status:500});
       }
};