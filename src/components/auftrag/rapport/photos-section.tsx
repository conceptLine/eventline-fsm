"use client";

// Foto-Sektion vom Rapport-Modal. Verwaltet eigenstaendig die Camera-/
// Datei-Inputs und delegiert das eigentliche Speichern (Upload + Caption-
// Update + Loeschen) an Callbacks im Parent — dort lebt der Service-Report-
// Draft + die Storage-Logik.

import { useRef } from "react";
import { Camera, Image as ImageIcon, X } from "lucide-react";
import type { UploadedPhoto } from "./types";

interface Props {
  photos: UploadedPhoto[];
  uploadCount: number;
  isReadOnly: boolean;
  onSelectFiles: (files: FileList) => void | Promise<void>;
  onRemove: (photo: UploadedPhoto) => void;
  onCaptionChange: (photo: UploadedPhoto, caption: string) => void;
}

export function PhotosSection({ photos, uploadCount, isReadOnly, onSelectFiles, onRemove, onCaptionChange }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    onSelectFiles(files);
    e.target.value = "";
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fotos</p>
        {(photos.length > 0 || uploadCount > 0) && (
          <span className="text-xs text-muted-foreground">
            {photos.length} Foto{photos.length !== 1 ? "s" : ""}
            {uploadCount > 0 && ` (${uploadCount} laden…)`}
          </span>
        )}
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group rounded-xl overflow-hidden border bg-muted/30">
              <div className="aspect-square relative">
                <img src={photo.preview_url} alt={photo.caption || "Foto"} className="w-full h-full object-cover" />
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => onRemove(photo)}
                    className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    aria-label="Foto entfernen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <input
                type="text"
                placeholder="Beschreibung..."
                value={photo.caption}
                onChange={(e) => onCaptionChange(photo, e.target.value)}
                disabled={isReadOnly}
                className="w-full px-2.5 py-2 text-xs border-t bg-card focus:outline-none focus:bg-muted/30 disabled:opacity-70"
              />
            </div>
          ))}
        </div>
      )}
      {!isReadOnly && (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={uploadCount > 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-60"
            >
              <Camera className="h-5 w-5" />
              Foto aufnehmen
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadCount > 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-60"
            >
              <ImageIcon className="h-5 w-5" />
              Aus Galerie
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleChange} className="hidden" />
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleChange} className="hidden" />
        </>
      )}
    </div>
  );
}
