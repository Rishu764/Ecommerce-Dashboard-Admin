import prismadb from "@/lib/prismadb";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request,
    { params }: { params: { sizeId: string, storeId: string } }) {
    try {
        const { userId } = auth();
        if (!userId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const body = await req.json();
        const { name, value } = body;

        if (!name) {
            return new NextResponse('Name is Required', { status: 400 });
        }

        if (!value) {
            return new NextResponse('Value is Required', { status: 400 });
        }

        if (!params.sizeId) {
            return new NextResponse('Size id is Required', { status: 400 });
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

        const size = await prismadb.size.updateMany({
            where: {
                id: params.sizeId,
            },
            data: {
                name,
                value,
            }
        });

        return NextResponse.json(size);
    } catch (err) {
        console.log('[SIZE_PATCH]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: { sizeId: string, storeId: string } }) {

    const { userId } = auth();
    console.log('userId', userId, 'params', params);
    if (!userId) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!params.sizeId) {
        return new NextResponse('Size id is Required', { status: 400 });
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

        const size = await prismadb.size.deleteMany({
            where: {
                id: params.sizeId,
                storeId: params.storeId
            }
        });
        return NextResponse.json(size);
    } catch (err) {
        console.log('[SIZE_DELETE]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}

export async function GET(
    req: Request,
    { params }: { params: { sizeId: string } }) {



    if (!params.sizeId) {
        return new NextResponse('Size id is Required', { status: 400 });
    }


    try {

        const size = await prismadb.size.findUnique({
            where: {
                id: params.sizeId,
            }
        });
        return NextResponse.json(size);
    } catch (err) {
        console.log('[SIZE_GET]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}