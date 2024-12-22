import prismadb from "@/lib/prismadb";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";


export async function POST(
    req: Request, 
    { params }: { params: { storeId: string } })
{
   try{
      const {userId} = auth();
      const body = await req.json();
      const {name, value} = body;

      if(!userId){
        return new NextResponse('Unauthenticated', { status: 401 });
      }

      if(!params.storeId){
        return new NextResponse('Store id is Required', { status: 400 });
      }

      const storeByUserId = await prismadb.store.findFirst({
        where:{
            id:params.storeId,
            userId,
        }
      });

      if(!storeByUserId){
        return new NextResponse('Unauthorized', { status: 403 });
      }


      if(!name){
        return new NextResponse('Name is Required', { status: 400 });
      }

      if(!value){
          return new NextResponse('Value is Required', { status: 400 });
      }

      const size = await prismadb.size.create({
        data:{
            storeId: params.storeId,
            name,
            value
        }
      });

      return NextResponse.json(size);
   }catch(err){
       console.log('[SIZE_POST]', err);
       return new NextResponse('Internal Server Error', { status: 500 });
   }    
}

export async function GET(
    req: Request, 
    { params }: { params: { storeId: string } })
{
   try{

      if(!params.storeId){
        return new NextResponse('Store id is Required', { status: 400 });
      }

      const sizes = await prismadb.size.findMany({
         where:{
          storeId: params.storeId,
         }
      });

      return NextResponse.json(sizes);
   }catch(err){
       console.log('[GET_SIZES]', err);
       return new NextResponse('Internal Server Error', { status: 500 });
   }    
}