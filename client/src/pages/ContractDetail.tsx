import { useState, useEffect } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { ArrowLeft, FileText, Download, CheckCircle2, XCircle, Clock, CreditCard, History, Edit, Info, AlertCircle } from 'lucide-react';
import { MainLayout } from '@/components/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth, getAuthToken } from '@/lib/auth';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import type { Contract } from '@shared/schema';
import { apiRequest } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { getAPIBaseURL } from '@/lib/apiConfig';
import { ContractSignatureDialog } from '@/components/ContractSignatureDialog';
import { DocumentUpload } from '@/components/DocumentUpload';
import { PaymentHistory } from '@/components/PaymentHistory';
import { safeRedirect } from '@/lib/security';

export default function ContractDetail() {
  const params = useParams();
  const contractId = params.id ? parseInt(params.id) : null;
  const { isStudent, isOwner, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [editData, setEditData] = useState({
    monthly_rent: 0,
    charges: 0,
    deposit_amount: 0,
    start_date: '',
    end_date: '',
  });

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      setLocation('/login');
      return;
    }
  }, [isAuthenticated, setLocation]);

  // Handle Stripe payment return
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const payment = urlParams.get('payment');
    const type = urlParams.get('type');
    
    if (payment === 'success') {
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/payments', contractId] });
      
      if (type === 'deposit') {
        toast({
          title: 'Paiement de la caution réussi',
          description: 'Votre caution a été traitée avec succès.',
        });
      } else {
        toast({
          title: 'Configuration du paiement réussie',
          description: 'Votre abonnement a été configuré avec succès. Les paiements mensuels seront traités automatiquement.',
        });
      }
      
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (payment === 'cancelled') {
      toast({
        title: 'Paiement annulé',
        description: 'Le paiement a été annulé. Vous pouvez réessayer à tout moment.',
        variant: 'destructive',
      });
      
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [contractId, toast]);

  const { data: contractData, isLoading } = useQuery<{ success: boolean; contract: Contract }>({
    queryKey: ['/contracts', contractId],
    enabled: !!contractId && isAuthenticated,
    queryFn: async () => {
      if (!contractId) throw new Error('Contract ID required');
      return apiRequest<{ success: boolean; contract: Contract }>('GET', `/contracts/${contractId}`);
    },
  });

  const contract = contractData?.contract;

  // Initialiser les données d'édition quand le contrat est chargé
  useEffect(() => {
    if (contract && contract.start_date && contract.end_date) {
      const startDate = contract.start_date.split('T')[0] || '';
      const endDate = contract.end_date.split('T')[0] || '';
      setEditData({
        monthly_rent: contract.monthly_rent,
        charges: contract.charges ?? 0,
        deposit_amount: contract.deposit_amount,
        start_date: startDate,
        end_date: endDate,
      });
    }
  }, [contract]);

  const updateContractMutation = useMutation({
    mutationFn: (data: typeof editData) => {
      return apiRequest('PUT', `/contracts/${contractId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/my-contracts'] });
      toast({ title: 'Succès', description: 'Contrat mis à jour avec succès' });
      setEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });

  const signContractMutation = useMutation({
    mutationFn: (signatureData: string) => {
      // Vérifier et logger la signature avant envoi
      console.log('Signature data length:', signatureData?.length);
      console.log('Signature data starts with:', signatureData?.substring(0, 50));
      console.log('Signature data type:', typeof signatureData);
      
      if (!signatureData || !signatureData.startsWith('data:image/')) {
        console.error('Invalid signature format before sending:', signatureData?.substring(0, 100));
        throw new Error('Format de signature invalide');
      }
      
      // Les étudiants utilisent /accept, les propriétaires peuvent utiliser /status
      if (isStudent) {
        return apiRequest('PUT', `/contracts/${contractId}/accept`, { 
          signature: signatureData 
        });
      } else {
        return apiRequest('PUT', `/contracts/${contractId}/status`, { 
          status: 'active',
          signature: signatureData 
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/my-contracts'] });
      toast({ title: 'Succès', description: 'Contrat signé avec succès' });
      setSignatureDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });

  const handleSignContract = async (signatureData: string) => {
    await signContractMutation.mutateAsync(signatureData);
  };

  // Activate Formula B subscription (monthly 4% payment)
  const createSubscriptionMutation = useMutation({
    mutationFn: () => {
      if (!contractId) throw new Error('ID de contrat requis');
      // Try new endpoint first, fallback to old one for backward compatibility
      return apiRequest<{ success: boolean; checkout_url?: string; subscription_id?: string; requires_owner_setup?: boolean }>(
        'POST', 
        '/payments/activate-formula-b', 
        { contract_id: contractId }
      ).catch(() => {
        // Fallback to old endpoint if new one doesn't exist yet
        return apiRequest<{ success: boolean; checkout_url: string; requires_owner_setup?: boolean }>(
          'POST', 
          '/contracts/create-subscription', 
          { contract_id: contractId }
        );
      });
    },
    onSuccess: (data) => {
      if (data.requires_owner_setup) {
        toast({ 
          title: 'Configuration requise', 
          description: 'Vous devez compléter la configuration Stripe avant de pouvoir activer l\'abonnement.',
          variant: 'destructive' 
        });
        return;
      }
      if (data.checkout_url) {
        toast({ 
          title: 'Redirection vers Stripe', 
          description: 'Vous allez être redirigé pour compléter la configuration du paiement.' 
        });
        safeRedirect(data.checkout_url, `/contracts/${contractId}`);
      } else if (data.subscription_id) {
        // Subscription created successfully without redirect
        queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
        queryClient.invalidateQueries({ queryKey: ['/payments/contract', contractId] });
        toast({
          title: 'Succès',
          description: 'Abonnement activé avec succès. Les paiements seront effectués automatiquement chaque mois.',
        });
      } else {
        toast({ 
          title: 'Erreur', 
          description: 'Aucune réponse valide reçue du serveur.',
          variant: 'destructive' 
        });
      }
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Échec de l\'activation de l\'abonnement. Veuillez réessayer.';
      toast({ 
        title: 'Erreur d\'activation', 
        description: errorMessage, 
        variant: 'destructive' 
      });
    },
  });

  const cancelSubscriptionMutation = useMutation({
    mutationFn: () => {
      if (!contractId) throw new Error('ID de contrat requis');
      return apiRequest('POST', '/contracts/cancel-subscription', { contract_id: contractId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/payments', contractId] });
      toast({ 
        title: 'Abonnement annulé', 
        description: 'Votre abonnement a été annulé. Les paiements automatiques s\'arrêteront.' 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: 'Erreur d\'annulation', 
        description: error.message || 'Échec de l\'annulation de l\'abonnement. Veuillez réessayer.',
        variant: 'destructive' 
      });
    },
  });

  const payDepositMutation = useMutation({
    mutationFn: () => {
      if (!contractId) throw new Error('ID de contrat requis');
      return apiRequest<{ success: boolean; checkout_url: string; requires_owner_setup?: boolean }>('POST', '/contracts/pay-deposit', { contract_id: contractId });
    },
    onSuccess: (data) => {
      if (data.requires_owner_setup) {
        toast({ 
          title: 'Configuration requise', 
          description: 'Le propriétaire doit compléter la configuration Stripe avant que les paiements puissent être traités.',
          variant: 'destructive' 
        });
        return;
      }
      if (data.checkout_url) {
        toast({ 
          title: 'Redirection vers Stripe', 
          description: 'Vous allez être redirigé pour compléter le paiement de la caution.' 
        });
        safeRedirect(data.checkout_url, '/contracts');
      } else {
        toast({ 
          title: 'Erreur', 
          description: 'Aucune URL de paiement reçue du serveur.',
          variant: 'destructive' 
        });
      }
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Échec du traitement du paiement de la caution. Veuillez réessayer.';
      toast({ 
        title: 'Erreur de paiement', 
        description: errorMessage, 
        variant: 'destructive' 
      });
    },
  });

  const { data: paymentsData } = useQuery<{ success: boolean; payments: any[] }>({
    queryKey: ['/contracts/payments', contractId],
    enabled: !!contractId && contract?.status === 'active',
    queryFn: async () => {
      if (!contractId) throw new Error('Contract ID required');
      return apiRequest<{ success: boolean; payments: any[] }>('GET', `/contracts/payments/${contractId}`);
    },
  });

  // Process Formula A payment (one-time 800 CHF)
  const processFormulaAPaymentMutation = useMutation({
    mutationFn: () => {
      if (!contractId) throw new Error('ID de contrat requis');
      return apiRequest<{ success: boolean; checkout_url?: string; payment_intent_id?: string }>('POST', '/payments/process-formula-a', { contract_id: contractId });
    },
    onSuccess: (data) => {
      if (data.checkout_url) {
        toast({
          title: 'Redirection vers Stripe',
          description: 'Vous allez être redirigé pour compléter le paiement.',
        });
        safeRedirect(data.checkout_url, `/contracts/${contractId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
        queryClient.invalidateQueries({ queryKey: ['/payments/contract', contractId] });
        toast({
          title: 'Succès',
          description: 'Paiement de 800 CHF traité avec succès',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur de paiement',
        description: error.message || 'Échec du traitement du paiement',
        variant: 'destructive',
      });
    },
  });

  // Retry failed payment
  const retryPaymentMutation = useMutation({
    mutationFn: (paymentId: number) => {
      if (!contractId) throw new Error('ID de contrat requis');
      return apiRequest('POST', `/payments/retry/${paymentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments/contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
      toast({
        title: 'Succès',
        description: 'Nouvelle tentative de paiement lancée',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Échec de la nouvelle tentative',
        variant: 'destructive',
      });
    },
  });

  // Upload departure proof
  const handleDepartureProofUpload = async (url: string) => {
    // Calculate billing_stopped_at (departure_date + 30 days)
    // The backend should handle this, but we can also set it here if needed
    queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
    toast({
      title: 'Succès',
      description: 'Preuve de départ uploadée. La facturation s\'arrêtera automatiquement 30 jours après la date de départ.',
    });
  };

  // Handle departure date update
  const updateDepartureDateMutation = useMutation({
    mutationFn: (departureDate: string) => {
      if (!contractId) throw new Error('ID de contrat requis');
      // Calculate billing_stopped_at: departure_date + 30 days
      const departure = new Date(departureDate);
      const billingStopped = new Date(departure);
      billingStopped.setDate(billingStopped.getDate() + 30);
      
      return apiRequest('PUT', `/contracts/${contractId}`, {
        departure_date: departureDate,
        billing_stopped_at: billingStopped.toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
      toast({
        title: 'Succès',
        description: 'Date de départ enregistrée. La facturation s\'arrêtera automatiquement 30 jours après cette date.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Échec de la mise à jour de la date de départ',
        variant: 'destructive',
      });
    },
  });

  const handleDownloadPDF = async () => {
    if (!contractId) {
      toast({
        title: 'Erreur',
        description: 'ID de contrat manquant',
        variant: 'destructive',
      });
      return;
    }

    const token = getAuthToken();
    if (!token) {
      toast({
        title: 'Erreur',
        description: 'Vous devez être connecté pour télécharger le PDF',
        variant: 'destructive',
      });
      return;
    }

    try {
      const apiBase = getAPIBaseURL();
      const baseClean = apiBase.replace(/\/+$/, '');
      const url = `${baseClean}/contracts/${contractId}/pdf`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erreur lors du téléchargement' }));
        throw new Error(errorData.error || `Erreur ${response.status}: ${response.statusText}`);
      }

      // Get the PDF response
      const blob = await response.blob();
      
      // Create a download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `contract-${contractId}.pdf`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      toast({
        title: 'Succès',
        description: 'PDF téléchargé avec succès',
      });
    } catch (error) {
      console.error('Erreur téléchargement PDF:', error);
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Impossible de télécharger le PDF',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-96 w-full max-w-4xl mx-auto" />
        </div>
      </MainLayout>
    );
  }

  if (!contract) {
    return (
      <MainLayout>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-4">Contract Not Found</h1>
          <Link href={isOwner ? '/dashboard/owner' : '/profile'}>
            <Button data-testid="button-dashboard">Back to Dashboard</Button>
          </Link>
        </div>
      </MainLayout>
    );
  }

  const canSign = (isStudent && contract.status === 'pending' && !contract.student_signature) ||
                  (isOwner && contract.status === 'pending' && !contract.owner_signature);
  const needsOwnerSignature = isOwner && contract.status === 'pending' && !contract.owner_signature;
  const needsStudentSignature = isStudent && contract.status === 'pending' && !contract.student_signature;
  const statusIcon = {
    pending: <Clock className="h-5 w-5 text-yellow-600" />,
    active: <CheckCircle2 className="h-5 w-5 text-green-600" />,
    completed: <CheckCircle2 className="h-5 w-5 text-green-600" />,
    cancelled: <XCircle className="h-5 w-5 text-red-600" />,
  }[contract.status];

  return (
    <MainLayout>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href={isOwner ? '/dashboard/owner' : '/profile'}>
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>

        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                    <CardTitle>Rental Contract</CardTitle>
                  </div>
                  <CardDescription>Contract ID: {contract.id}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {statusIcon}
                  <Badge
                    variant={
                      contract.status === 'active' ? 'default' :
                      contract.status === 'pending' ? 'secondary' :
                      'outline'
                    }
                  >
                    {contract.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {canSign && (
                <Alert>
                  <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
                    <span>
                      {needsStudentSignature && 'Veuillez examiner et signer ce contrat pour procéder avec votre location'}
                      {needsOwnerSignature && 'Veuillez signer ce contrat pour le finaliser'}
                    </span>
                    <Button
                      onClick={() => setSignatureDialogOpen(true)}
                      disabled={signContractMutation.isPending}
                      data-testid="button-sign-contract"
                    >
                      {signContractMutation.isPending ? 'Signature en cours...' : 'Signer le contrat'}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <h3 className="font-semibold mb-3">Property Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Property</p>
                    <p className="font-medium" data-testid="text-property-title">{contract.property_title}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">{contract.city_name}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-3">Parties</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Property Owner</p>
                    <p className="font-medium">
                      {contract.owner_first_name} {contract.owner_last_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tenant</p>
                    <p className="font-medium">
                      {contract.student_first_name} {contract.student_last_name}
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-3">Contract Terms</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Start Date</p>
                    <p className="font-medium">{new Date(contract.start_date).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">End Date</p>
                    <p className="font-medium">{new Date(contract.end_date).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="font-medium">
                      {Math.round(
                        (new Date(contract.end_date).getTime() - new Date(contract.start_date).getTime()) /
                        (1000 * 60 * 60 * 24 * 30)
                      )} months
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Financial Details</h3>
                  {isOwner && (contract.status === 'pending' || contract.is_editable) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (contract && contract.start_date && contract.end_date) {
                          const startDate = contract.start_date.split('T')[0] || '';
                          const endDate = contract.end_date.split('T')[0] || '';
                          setEditData({
                            monthly_rent: contract.monthly_rent,
                            charges: contract.charges ?? 0,
                            deposit_amount: contract.deposit_amount,
                            start_date: startDate,
                            end_date: endDate,
                          });
                          setEditDialogOpen(true);
                        }
                      }}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Modifier
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly Rent</p>
                    <p className="font-semibold text-lg">CHF {Number(contract.monthly_rent || 0).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Charges</p>
                    <p className="font-semibold text-lg">CHF {Number(contract.charges || 0).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Deposit</p>
                    <p className="font-semibold text-lg">CHF {Number(contract.deposit_amount || 0).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  {isOwner && (
                    <div>
                      <p className="text-sm text-muted-foreground">Your Monthly Payout</p>
                      <p className="font-semibold text-lg">CHF {Number(contract.owner_payout || 0).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <p className="text-xs text-muted-foreground mt-1">After platform fee</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Total mensuel</p>
                    <p className="font-semibold text-lg">CHF {(Number(contract.monthly_rent || 0) + Number(contract.charges || 0)).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-xs text-muted-foreground mt-1">Loyer + Charges</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-3">Signatures</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Propriétaire (LE BAILLEUR)</p>
                    {contract.owner_signature ? (
                      <div className="space-y-2">
                        <div className="border rounded p-3 bg-muted/20">
                          <img 
                            src={contract.owner_signature} 
                            alt="Signature du propriétaire" 
                            className="max-h-20 mx-auto"
                          />
                        </div>
                        {contract.owner_signed_at && (
                          <p className="text-xs text-muted-foreground">
                            Signé le {new Date(contract.owner_signed_at).toLocaleDateString('fr-CH', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">En attente de signature</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Locataire (LE LOCATAIRE)</p>
                    {contract.student_signature ? (
                      <div className="space-y-2">
                        <div className="border rounded p-3 bg-muted/20">
                          <img 
                            src={contract.student_signature} 
                            alt="Signature du locataire" 
                            className="max-h-20 mx-auto"
                          />
                        </div>
                        {contract.student_signed_at && (
                          <p className="text-xs text-muted-foreground">
                            Signé le {new Date(contract.student_signed_at).toLocaleDateString('fr-CH', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">En attente de signature</p>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-3">Contract Status</h3>
                <div className="flex items-center gap-2">
                  {statusIcon}
                  <p className="text-sm">
                    {contract.status === 'active' && 'Contract is active'}
                    {contract.status === 'pending' && 'Contract is pending approval'}
                    {contract.status === 'completed' && 'Contract has been completed'}
                    {contract.status === 'cancelled' && 'Contract has been cancelled'}
                  </p>
                </div>
              </div>

              <Tabs defaultValue="details" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  {contract?.status === 'active' && (
                    <>
                      <TabsTrigger value="payments">
                        <CreditCard className="h-4 w-4 mr-2" />
                        Payments
                      </TabsTrigger>
                      <TabsTrigger value="history">
                        <History className="h-4 w-4 mr-2" />
                        History
                      </TabsTrigger>
                    </>
                  )}
                </TabsList>

                <TabsContent value="details" className="space-y-4">
                  <div className="flex gap-4 pt-4">
                    <Button
                      onClick={handleDownloadPDF}
                      variant="outline"
                      className="flex-1"
                      data-testid="button-download-pdf"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download PDF
                    </Button>
                    {canSign && (
                      <Button
                        onClick={() => setSignatureDialogOpen(true)}
                        disabled={signContractMutation.isPending}
                        className="flex-1"
                        data-testid="button-sign"
                      >
                        {signContractMutation.isPending ? 'Signature en cours...' : 'Signer le contrat'}
                      </Button>
                    )}
                  </div>
                </TabsContent>

                {contract?.status === 'active' && (
                  <>
                    <TabsContent value="payments" className="space-y-6">
                      {/* Payment Formula Display */}
                      {contract.payment_formula && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">Formule de commission</CardTitle>
                            <CardDescription>
                              {contract.payment_formula === 'A' 
                                ? 'Paiement unique de 800 CHF après signature du bail'
                                : 'Abonnement mensuel de 4% du loyer charges comprises'}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm text-muted-foreground">Formule sélectionnée</p>
                                <p className="font-semibold text-lg">
                                  Formule {contract.payment_formula} - {contract.payment_formula === 'A' ? '800 CHF' : `${contract.commission_amount?.toFixed(2) || '0.00'} CHF/mois`}
                                </p>
                              </div>
                              <Badge variant={contract.payment_formula === 'A' ? 'default' : 'secondary'}>
                                {contract.payment_formula === 'A' ? 'Paiement unique' : 'Abonnement mensuel'}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Formula A Payment */}
                      {contract.payment_formula === 'A' && isOwner && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">Paiement Formule A</CardTitle>
                            <CardDescription>
                              Paiement unique de 800 CHF après validation de la preuve de signature
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {(() => {
                              const formulaAPaid = paymentsData?.payments?.some(
                                (p: any) => p.formula === 'A' && p.status === 'succeeded'
                              );
                              
                              if (formulaAPaid) {
                                return (
                                  <Alert className="border-green-200 bg-green-50">
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                    <AlertDescription>
                                      <p className="font-medium text-green-900 mb-1">Paiement effectué</p>
                                      <p className="text-sm text-green-700">
                                        Le paiement de 800 CHF a été traité avec succès. Merci !
                                      </p>
                                    </AlertDescription>
                                  </Alert>
                                );
                              }
                              
                              const hasLeaseProof = contract.lease_signature_proof_url;
                              
                              if (!hasLeaseProof) {
                                return (
                                  <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                      <p className="font-medium mb-1">Preuve de signature requise</p>
                                      <p className="text-sm">
                                        Vous devez d'abord uploader la preuve de signature du bail avant de pouvoir effectuer le paiement.
                                      </p>
                                    </AlertDescription>
                                  </Alert>
                                );
                              }
                              
                              return (
                                <Alert>
                                  <AlertDescription>
                                    <div className="space-y-3">
                                      <div>
                                        <p className="font-medium mb-1">Payer la commission (800 CHF)</p>
                                        <p className="text-sm text-muted-foreground">
                                          Le paiement sera effectué immédiatement après confirmation.
                                        </p>
                                      </div>
                                      <Button
                                        onClick={() => processFormulaAPaymentMutation.mutate()}
                                        disabled={processFormulaAPaymentMutation.isPending}
                                        className="w-full sm:w-auto"
                                      >
                                        {processFormulaAPaymentMutation.isPending ? (
                                          <>
                                            <Clock className="h-4 w-4 mr-2 animate-spin" />
                                            Traitement...
                                          </>
                                        ) : (
                                          <>
                                            <CreditCard className="h-4 w-4 mr-2" />
                                            Payer 800 CHF
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  </AlertDescription>
                                </Alert>
                              );
                            })()}
                          </CardContent>
                        </Card>
                      )}

                      {/* Formula B Subscription */}
                      {contract.payment_formula === 'B' && isOwner && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">Abonnement Formule B</CardTitle>
                            <CardDescription>
                              Paiement mensuel automatique de {contract.commission_amount?.toFixed(2) || '0.00'} CHF (4% du loyer)
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {(() => {
                              const hasLeaseProof = contract.lease_signature_proof_url;
                              const subscriptionActive = contract.stripe_subscription_id;
                              const billingStopped = contract.billing_stopped_at;
                              
                              if (billingStopped) {
                                return (
                                  <Alert className="border-blue-200 bg-blue-50">
                                    <Info className="h-4 w-4 text-blue-600" />
                                    <AlertDescription>
                                      <p className="font-medium text-blue-900 mb-1">Facturation arrêtée</p>
                                      <p className="text-sm text-blue-700">
                                        La facturation a été arrêtée le {new Date(billingStopped).toLocaleDateString('fr-CH')} suite au départ de l'étudiant.
                                      </p>
                                    </AlertDescription>
                                  </Alert>
                                );
                              }
                              
                              if (!hasLeaseProof) {
                                return (
                                  <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                      <p className="font-medium mb-1">Preuve de signature requise</p>
                                      <p className="text-sm">
                                        Vous devez d'abord uploader la preuve de signature du bail avant que l'abonnement puisse être activé.
                                      </p>
                                    </AlertDescription>
                                  </Alert>
                                );
                              }
                              
                              if (!subscriptionActive) {
                                return (
                                  <Alert>
                                    <AlertDescription>
                                      <div className="space-y-3">
                                        <div>
                                          <p className="font-medium mb-1">Activer l'abonnement mensuel</p>
                                          <p className="text-sm text-muted-foreground">
                                            Les paiements de {contract.commission_amount?.toFixed(2) || '0.00'} CHF seront effectués automatiquement chaque mois.
                                          </p>
                                        </div>
                                        <Button
                                          onClick={() => createSubscriptionMutation.mutate()}
                                          disabled={createSubscriptionMutation.isPending}
                                          className="w-full sm:w-auto"
                                        >
                                          {createSubscriptionMutation.isPending ? (
                                            <>
                                              <Clock className="h-4 w-4 mr-2 animate-spin" />
                                              Activation...
                                            </>
                                          ) : (
                                            <>
                                              <CreditCard className="h-4 w-4 mr-2" />
                                              Activer l'abonnement
                                            </>
                                          )}
                                        </Button>
                                      </div>
                                    </AlertDescription>
                                  </Alert>
                                );
                              }
                              
                              return (
                                <div className="space-y-3">
                                  <Alert className="border-green-200 bg-green-50">
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                    <AlertDescription>
                                      <div className="flex items-center justify-between flex-wrap gap-2">
                                        <div>
                                          <p className="font-medium text-green-900 mb-1">Abonnement actif</p>
                                          <p className="text-sm text-green-700">
                                            Les paiements sont traités automatiquement chaque mois.
                                          </p>
                                        </div>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          onClick={() => {
                                            if (confirm('Êtes-vous sûr de vouloir annuler l\'abonnement ? Les paiements automatiques s\'arrêteront.')) {
                                              cancelSubscriptionMutation.mutate();
                                            }
                                          }}
                                          disabled={cancelSubscriptionMutation.isPending}
                                        >
                                          {cancelSubscriptionMutation.isPending ? 'Annulation...' : 'Annuler'}
                                        </Button>
                                      </div>
                                    </AlertDescription>
                                  </Alert>
                                  <div className="grid grid-cols-2 gap-4 pt-2">
                                    <div>
                                      <p className="text-sm text-muted-foreground">Prochain paiement</p>
                                      <p className="font-semibold">
                                        {new Date(new Date().setMonth(new Date().getMonth() + 1)).toLocaleDateString('fr-CH', { 
                                          day: 'numeric', 
                                          month: 'long',
                                          year: 'numeric'
                                        })}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-sm text-muted-foreground">Montant</p>
                                      <p className="font-semibold">
                                        CHF {contract.commission_amount?.toFixed(2) || '0.00'}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </CardContent>
                        </Card>
                      )}

                      {/* Documents Section */}
                      {isOwner && (
                        <div className="space-y-4">
                          <h3 className="font-semibold text-lg">Documents</h3>
                          
                          {/* Lease Signature Proof */}
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">Preuve de signature du bail</CardTitle>
                              <CardDescription>
                                Upload obligatoire du PDF du bail signé
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <DocumentUpload
                                contractId={contractId!}
                                documentType="lease_signature"
                                existingUrl={contract.lease_signature_proof_url}
                                required={true}
                                onUploadSuccess={() => {
                                  queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
                                }}
                              />
                            </CardContent>
                          </Card>

                          {/* Student Departure Proof */}
                          {contract.status === 'active' && contract.payment_formula === 'B' && (
                            <Card>
                              <CardHeader>
                                <CardTitle className="text-base">Gestion du départ étudiant</CardTitle>
                                <CardDescription>
                                  Upload du PDF ou document signé prouvant le départ. La facturation s'arrêtera automatiquement 30 jours après la date de départ.
                                </CardDescription>
                              </CardHeader>
                              <CardContent className="space-y-4">
                                {!contract.departure_date && (
                                  <div className="space-y-2">
                                    <Label htmlFor="departure_date">Date de départ de l'étudiant</Label>
                                    <div className="flex gap-2">
                                      <Input
                                        id="departure_date"
                                        type="date"
                                        onChange={(e) => {
                                          if (e.target.value) {
                                            updateDepartureDateMutation.mutate(e.target.value);
                                          }
                                        }}
                                        disabled={updateDepartureDateMutation.isPending}
                                        className="flex-1"
                                      />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      La facturation s'arrêtera automatiquement 30 jours après cette date.
                                    </p>
                                  </div>
                                )}
                                
                                <DocumentUpload
                                  contractId={contractId!}
                                  documentType="student_departure"
                                  existingUrl={contract.student_departure_proof_url}
                                  onUploadSuccess={handleDepartureProofUpload}
                                />
                                
                                {contract.departure_date && (
                                  <Alert className="mt-4">
                                    <Info className="h-4 w-4" />
                                    <AlertDescription>
                                      <div className="space-y-1">
                                        <p className="text-sm font-medium">
                                          Date de départ: {new Date(contract.departure_date).toLocaleDateString('fr-CH', {
                                            day: 'numeric',
                                            month: 'long',
                                            year: 'numeric'
                                          })}
                                        </p>
                                        {contract.billing_stopped_at ? (
                                          <p className="text-sm">
                                            Facturation arrêtée le: {new Date(contract.billing_stopped_at).toLocaleDateString('fr-CH', {
                                              day: 'numeric',
                                              month: 'long',
                                              year: 'numeric'
                                            })}
                                          </p>
                                        ) : (
                                          <p className="text-sm text-muted-foreground">
                                            La facturation s'arrêtera le: {(() => {
                                              const departure = new Date(contract.departure_date);
                                              departure.setDate(departure.getDate() + 30);
                                              return departure.toLocaleDateString('fr-CH', {
                                                day: 'numeric',
                                                month: 'long',
                                                year: 'numeric'
                                              });
                                            })()}
                                          </p>
                                        )}
                                      </div>
                                    </AlertDescription>
                                  </Alert>
                                )}
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      )}

                      {/* Payment History */}
                      <div className="mt-6">
                        <PaymentHistory 
                          contractId={contractId!} 
                          onRetryPayment={(paymentId) => retryPaymentMutation.mutate(paymentId)}
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="history" className="space-y-4">
                      <PaymentHistory 
                        contractId={contractId!} 
                        onRetryPayment={(paymentId) => retryPaymentMutation.mutate(paymentId)}
                      />
                    </TabsContent>
                  </>
                )}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog d'édition du contrat */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier le contrat</DialogTitle>
            <DialogDescription>
              Vous pouvez modifier les détails du contrat. Les deux parties doivent être d'accord avec les modifications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="monthly_rent">Loyer mensuel (CHF)</Label>
              <Input
                id="monthly_rent"
                type="number"
                value={editData.monthly_rent}
                onChange={(e) => setEditData({ ...editData, monthly_rent: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor="charges">Charges mensuelles (CHF)</Label>
              <Input
                id="charges"
                type="number"
                value={editData.charges}
                onChange={(e) => setEditData({ ...editData, charges: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor="deposit_amount">Caution (CHF)</Label>
              <Input
                id="deposit_amount"
                type="number"
                value={editData.deposit_amount}
                onChange={(e) => setEditData({ ...editData, deposit_amount: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start_date">Date de début</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={editData.start_date}
                  onChange={(e) => setEditData({ ...editData, start_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="end_date">Date de fin</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={editData.end_date}
                  onChange={(e) => setEditData({ ...editData, end_date: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => updateContractMutation.mutate(editData)}
              disabled={updateContractMutation.isPending}
            >
              {updateContractMutation.isPending ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de signature électronique */}
      <ContractSignatureDialog
        open={signatureDialogOpen}
        onOpenChange={setSignatureDialogOpen}
        onSign={handleSignContract}
        role={isOwner ? 'owner' : 'student'}
        contractTitle={contract?.property_title}
        isLoading={signContractMutation.isPending}
      />
    </MainLayout>
  );
}
