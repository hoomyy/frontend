import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileText, Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { getAuthToken } from '@/lib/auth';
import { getAPIBaseURL } from '@/lib/apiConfig';
import type { documentTypes } from '@shared/schema';

interface DocumentUploadProps {
  contractId: number;
  documentType: typeof documentTypes[number];
  onUploadSuccess?: (url: string) => void;
  existingUrl?: string | null;
  label?: string;
  description?: string;
  required?: boolean;
}

export function DocumentUpload({
  contractId,
  documentType,
  onUploadSuccess,
  existingUrl,
  label,
  description,
  required = false,
}: DocumentUploadProps) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', documentType);
      formData.append('contract_id', contractId.toString());

      const token = getAuthToken();
      if (!token) {
        throw new Error('Authentification requise');
      }

      const apiBase = getAPIBaseURL();
      const baseClean = apiBase.replace(/\/+$/, '');
      const url = `${baseClean}/documents/upload`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Échec de l\'upload' }));
        throw new Error(errorData.error || 'Échec de l\'upload du document');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
      queryClient.invalidateQueries({ queryKey: ['/documents', contractId] });
      
      toast({
        title: 'Succès',
        description: 'Document uploadé avec succès',
      });

      if (onUploadSuccess) {
        onUploadSuccess(data.url);
      }

      setSelectedFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Échec de l\'upload du document',
        variant: 'destructive',
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      toast({
        title: 'Erreur',
        description: 'Le fichier doit être un PDF',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'Erreur',
        description: 'Le fichier ne doit pas dépasser 10 MB',
        variant: 'destructive',
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = () => {
    if (!selectedFile) return;
    setUploading(true);
    uploadMutation.mutate(selectedFile);
    setTimeout(() => setUploading(false), 1000);
  };

  const handleRemove = () => {
    setSelectedFile(null);
  };

  const displayLabel = label || (documentType === 'lease_signature' 
    ? 'Preuve de signature du bail (PDF)'
    : 'Preuve de départ de l\'étudiant (PDF)');

  const displayDescription = description || (documentType === 'lease_signature'
    ? 'Upload obligatoire du PDF du bail signé. Aucun paiement ne sera effectué sans cette preuve.'
    : 'Upload du PDF ou document signé prouvant le départ de l\'étudiant. La facturation s\'arrêtera 30 jours après validation.');

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">
          {displayLabel}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <p className="text-sm text-muted-foreground mt-1">{displayDescription}</p>
      </div>

      {existingUrl ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <strong>Document uploadé</strong>
                <p className="text-sm mt-1">
                  <a
                    href={existingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    <FileText className="h-3 w-3" />
                    Voir le document
                  </a>
                </p>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <Input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileSelect}
              className="flex-1"
              disabled={uploading}
            />
            {selectedFile && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemove}
                  disabled={uploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {selectedFile && (
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleUpload}
                disabled={uploading || uploadMutation.isPending}
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploading || uploadMutation.isPending ? 'Upload en cours...' : 'Uploader le document'}
              </Button>
            </div>
          )}

          {!selectedFile && !existingUrl && required && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Ce document est obligatoire pour continuer.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}


