import prismadb from "@/lib/prismadb";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request,
    { params }: { params: { categoryId: string, storeId: string } }) {
    try {
        const { userId } = auth();
        if (!userId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const body = await req.json();
        const { name, billboardId } = body;

        if (!name) {
            return new NextResponse('Name is Required', { status: 400 });
        }

        if (!billboardId) {
            return new NextResponse('Billboard Id is Required', { status: 400 });
        }

        if (!params.categoryId) {
            return new NextResponse('Category id is Required', { status: 400 });
        }

        if (!params.storeId) {
            return new NextResponse('Store id is Required', { status: 400 });
        }

        const storeByUserId = await prismadb.store.findFirst({
            where: {
                id: params.storeId,
                userId
            }
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 403 });
        }

        const category = await prismadb.category.updateMany({
            where: {
                id: params.categoryId,
            },
            data: {
                name,
                billboardId,
            }
        });

        return NextResponse.json(category);
    } catch (err) {
        console.log('[Category_PATCH]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: { categoryId: string, storeId: string } }) {

    const { userId } = auth();

    if (!userId) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!params.categoryId) {
        return new NextResponse('Category id is Required', { status: 400 });
    }

    if (!params.storeId) {
        return new NextResponse('Store id is Required', { status: 400 });
    }

    try {

        const storeByUserId = await prismadb.store.findFirst({
            where: {
                id: params.storeId,
                userId
            }
        });

        if (!storeByUserId) {
            return new NextResponse('Unauthorized', { status: 403 });
        }

        const category = await prismadb.category.deleteMany({
            where: {
                id: params.categoryId,
                storeId: params.storeId
            }
        });
        return NextResponse.json(category);
    } catch (err) {
        console.log('[CATEGORY_DELETE]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}

export async function GET(
    req: Request,
    { params }: { params: { categoryId: string } }) {



    if (!params.categoryId) {
        return new NextResponse('Category id is Required', { status: 400 });
    }


    try {

        const category = await prismadb.category.findUnique({
            where: {
                id: params.categoryId,
            }
        });
        return NextResponse.json(category);
    } catch (err) {
        console.log('[CATEGORY_GET]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}