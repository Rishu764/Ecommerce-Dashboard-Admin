"use client";

import { Button } from "@/components/ui/button";
import { ColorColumn } from "./columns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Copy, Edit, MoreHorizontal, Trash } from "lucide-react";
import toast from "react-hot-toast";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useState } from "react";
import AlertModal from "@/components/modals/alert-modal";

interface CellActionProps{
    data: ColorColumn
}

export const CellAction:React.FC<CellActionProps> = ({
    data,
})=>{
    const router = useRouter();
    const params = useParams();

    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);


    const onCopy = (id:string)=>{
        navigator.clipboard.writeText(id);
        toast.success('Color Id Copied!')
    }

    const onDelete = async () => {
        try {
            setLoading(true);
            await axios.delete(`/api/${params.storeId}/colors/${data.id}`);
            toast.success('Color Deleted.');
            router.refresh();
        } catch (err) {
            toast.error('Make sure you removed all products using this color first.');
        } finally {
            setLoading(false);
            setOpen(false);
        }
    }

    return(
      <>
         <AlertModal
          isOpen={open}
          onClose={()=>setOpen(false)}
          onConfirm={onDelete}
          loading={loading}
         />
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal  className="h-4 w-4" />
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" >
              <DropdownMenuLabel>
                Actions
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={()=> router.push(`/${params.storeId}/colors/${data.id}`)}>
                <Edit className="mr-2 h-4 w-4"/>
                Update
              </DropdownMenuItem>
              <DropdownMenuItem onClick={()=>onCopy(data.id)}>
                <Copy className="mr-2 h-4 w-4"/>
                Copy Id
              </DropdownMenuItem>
              <DropdownMenuItem onClick={()=>setOpen(true)}>
                <Trash className="mr-2 h-4 w-4"/>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>

        </DropdownMenu>
      </>
    );
}