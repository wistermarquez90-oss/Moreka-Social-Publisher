import { useRef, useState } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function MediaUploadDialog({ productId, editorialPostId, kind, open, onOpenChange }: { productId?: number; editorialPostId?: number; kind: "image" | "video"; open: boolean; onOpenChange: (open: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const utils = trpc.useUtils();
  const onSuccess = async () => {
    toast.success(kind === "image" ? "Imagen actualizada" : "Video actualizado");
    setFile(null);
    onOpenChange(false);
    await utils.review.invalidate();
  };
  const uploadProduct = trpc.review.uploadMedia.useMutation({ onSuccess, onError: (error) => toast.error(error.message) });
  const uploadEditorial = trpc.editorial.uploadMedia.useMutation({ onSuccess, onError: (error) => toast.error(error.message) });
  const pending = uploadProduct.isPending || uploadEditorial.isPending;

  async function submit() {
    if (!file) return;
    if (file.size > 33 * 1024 * 1024) {
      toast.error("El archivo supera el límite de 33 MB");
      return;
    }
    try {
      const contentBase64 = await toBase64(file);
      const payload = { kind, fileName: file.name, contentType: file.type || `${kind}/octet-stream`, contentBase64 };
      if (editorialPostId) uploadEditorial.mutate({ ...payload, editorialPostId });
      else if (productId) uploadProduct.mutate({ ...payload, productId });
    } catch {
      toast.error("No se pudo leer el archivo");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Cargar {kind === "image" ? "imagen" : "video"}</DialogTitle><DialogDescription>El nuevo archivo sustituirá el recurso actual. El cambio devolverá la publicación a revisión.</DialogDescription></DialogHeader>
        <button type="button" className="upload-drop" onClick={() => inputRef.current?.click()}>
          <FileUp className="h-7 w-7" />
          <span>{file ? file.name : `Seleccionar archivo de ${kind === "image" ? "imagen" : "video"}`}</span>
          <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Máximo 33 MB"}</small>
        </button>
        <input ref={inputRef} className="hidden" type="file" accept={kind === "image" ? "image/*" : "video/*"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!file || pending} onClick={submit}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Subir archivo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
