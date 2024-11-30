import prismadb from "@/lib/prismadb";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request,
    { params }: { params: { billboardId: string, storeId: string } }) {
    try {
        const { userId } = auth();
        if (!userId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const body = await req.json();
        const { label, imageUrl } = body;

        if (!label) {
            return new NextResponse('Label is Required', { status: 400 });
        }

        if (!imageUrl) {
            return new NextResponse('Image Url is Required', { status: 400 });
        }

        if (!params.billboardId) {
            return new NextResponse('Billboard id is Required', { status: 400 });
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

        const billboard = await prismadb.billboard.updateMany({
            where: {
                id: params.billboardId,
            },
            data: {
                label,
                imageUrl,
            }
        });

        return NextResponse.json(billboard);
    } catch (err) {
        console.log('[BILLBOARD_PATCH]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: { billboardId: string, storeId: string } }) {

    const { userId } = auth();
    console.log('userId', userId, 'params', params);
    if (!userId) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!params.billboardId) {
        return new NextResponse('Billboard id is Required', { status: 400 });
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

        const billboard = await prismadb.billboard.deleteMany({
            where: {
                id: params.billboardId,
                storeId: params.storeId
            }
        });
        return NextResponse.json(billboard);
    } catch (err) {
        console.log('[BILLBOARD_DELETE]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}

export async function GET(
    req: Request,
    { params }: { params: { billboardId: string } }) {



    if (!params.billboardId) {
        return new NextResponse('Billboard id is Required', { status: 400 });
    }


    try {

        const billboard = await prismadb.billboard.findUnique({
            where: {
                id: params.billboardId,
            }
        });
        return NextResponse.json(billboard);
    } catch (err) {
        console.log('[BILLBOARD_DELETE]', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }

}