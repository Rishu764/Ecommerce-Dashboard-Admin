import prismadb from "@/lib/prismadb";
import { redirect } from "next/navigation";

interface DashboardPageProps{
    params:{storeId: string};
}

const DashboardPage:React.FC<DashboardPageProps> = async({
  params
}) =>{

    const store = await prismadb.store.findFirst({
        where:{
            id:params.storeId
        }
    });

    if(!store){
        redirect('/')
    }

    return (
        <>
         Store : { store?.name}
        </>
    )
};

export default DashboardPage;