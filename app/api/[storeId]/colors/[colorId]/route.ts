import prismadb from "@/lib/prismadb";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request,
    { params }: { params: { colorId: string, storeId: string } }) {
    try {
        const { userId } = auth();
        if (!userId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        console.log('here');

        const body = await req.json();
        const { name, value } = body;

        console.log(params.colorId, params.storeId);

        if (!name) {
            return new NextResponse('Name is Required', { status: 400 });
        }

        if (!value) {
            return new NextResponse('Value is Required', { status: 400 });
        }

        if (!params.colorId) {
            return new NextResponse('Color id is Required', { status: 400 });
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

        const color = await prismadb.color.updateMany({
            where: {
                id: params.colorId,
            },
            data: {
                name,
                value,
            }
        });

        console.log(color)

        return NextResponse.json(color);
    } catch (err) {
        console.log('[COLOR_PATCH]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: { colorId: string, storeId: string } }) {

    const { userId } = auth();
    console.log('userId', userId, 'params', params);
    if (!userId) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!params.colorId) {
        return new NextResponse('Color id is Required', { status: 400 });
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

        const color = await prismadb.color.deleteMany({
            where: {
                id: params.colorId,
                storeId: params.storeId
            }
        });
        return NextResponse.json(color);
    } catch (err) {
        console.log('[COLOR_DELETE]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}

export async function GET(
    req: Request,
    { params }: { params: { colorId: string } }) {



    if (!params.colorId) {
        return new NextResponse('Color id is Required', { status: 400 });
    }


    try {

        const color = await prismadb.color.findUnique({
            where: {
                id: params.colorId,
            }
        });
        return NextResponse.json(color);
    } catch (err) {
        console.log('[COLOR_GET]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}