import { useState, useEffect } from 'react';
import { useLocation, Link, useParams } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, FileText, CreditCard, Info, AlertCircle } from 'lucide-react';
import { MainLayout } from '@/components/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { createContractSchema, type CreateContractInput, type PaymentMethod } from '@shared/schema';
import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/apiConfig';
import type { Property, User } from '@shared/schema';
import { PaymentMethodManager } from '@/components/PaymentMethodManager';
import { useToast } from '@/hooks/use-toast';

export default function CreateContract() {
  const params = useParams();
  const propertyId = params.propertyId ? parseInt(params.propertyId) : null;
  const [, setLocation] = useLocation();
  const { isOwner } = useAuth();
  const { toast } = useToast();
  const [error, setError] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [leaseProofFile, setLeaseProofFile] = useState<File | null>(null);

  const { data: property, isLoading: propertyLoading } = useQuery<Property>({
    queryKey: [`/properties/${propertyId}`],
    enabled: !!propertyId,
    queryFn: async () => {
      if (!propertyId) throw new Error('Property ID required');
      return apiRequest<Property>('GET', `/properties/${propertyId}`);
    },
  });

  const { data: students } = useQuery<User[]>({
    queryKey: ['/users/students'],
    enabled: isOwner,
    queryFn: async () => {
      return apiRequest<User[]>('GET', '/users/students');
    },
  });

  // Fetch payment methods
  const { data: paymentMethods } = useQuery<PaymentMethod[]>({
    queryKey: ['/payment-methods'],
    enabled: isOwner,
    queryFn: async () => {
      try {
        return apiRequest<PaymentMethod[]>('GET', '/payment-methods');
      } catch {
        return [];
      }
    },
  });

  const form = useForm<CreateContractInput & { payment_formula: 'A' | 'B' }>({
    resolver: zodResolver(createContractSchema),
    defaultValues: {
      property_id: propertyId || 0,
      student_id: 0,
      start_date: '',
      end_date: '',
      monthly_rent: property?.price || 0,
      deposit_amount: property?.price ? property.price * 3 : 0,
      charges: property?.charges || 0,
      payment_formula: 'A',
      save_payment_method: false,
    },
  });

  useEffect(() => {
    if (property) {
      form.setValue('monthly_rent', property.price);
      form.setValue('deposit_amount', property.price * 3);
      form.setValue('charges', property.charges || 0);
    }
  }, [property]);

  // Set default payment method if available
  useEffect(() => {
    if (paymentMethods && paymentMethods.length > 0) {
      const defaultMethod = paymentMethods.find(m => m.is_default) || paymentMethods[0];
      if (defaultMethod) {
        setSelectedPaymentMethod(defaultMethod.id);
        form.setValue('payment_method_id', defaultMethod.id);
      }
    }
  }, [paymentMethods]);

  // Calculate commission based on formula
  const monthlyRent = Number(form.watch('monthly_rent')) || 0;
  const charges = Number(form.watch('charges')) || 0;
  const paymentFormula = form.watch('payment_formula') || 'A';
  const totalRent = monthlyRent + charges;
  
  const commissionAmount = paymentFormula === 'A' 
    ? 800 // Formule A: 800 CHF fixe
    : totalRent > 0 
      ? Math.round(totalRent * 0.04 * 100) / 100 // Formule B: 4% du loyer mensuel charges comprises
      : 0; // Fallback to 0 if totalRent is invalid

  const createContractMutation = useMutation({
    mutationFn: async (data: CreateContractInput & { payment_formula: 'A' | 'B' }) => {
      // Create contract first (without PDF URL, will be uploaded after)
      const contractData = {
        ...data,
        commission_amount: commissionAmount, // Include calculated commission amount
      };

      const result = await apiRequest<{ success: boolean; contract: { id: number } }>('POST', '/contracts/create', contractData);
      
      // Then upload PDF if provided (now we have the real contract_id)
      if (leaseProofFile && result.contract?.id) {
        try {
          const formData = new FormData();
          formData.append('file', leaseProofFile);
          formData.append('type', 'lease_signature');
          formData.append('contract_id', result.contract.id.toString());
          
          const token = localStorage.getItem('auth_token');
          const apiBase = getAPIBaseURL();
          const baseClean = apiBase.replace(/\/+$/, '');
          const uploadUrl = `${baseClean}/documents/upload`;
          
          const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
            body: formData,
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Échec de l\'upload du PDF' }));
            throw new Error(errorData.error || 'Échec de l\'upload du PDF');
          }
          
          // Update contract with PDF URL
          const uploadResponse = await response.json();
          if (uploadResponse.url) {
            await apiRequest('PUT', `/contracts/${result.contract.id}/upload-lease-proof`, {
              lease_signature_proof_url: uploadResponse.url,
            });
          }
        } catch (uploadError) {
          // Log error but don't fail contract creation
          console.error('PDF upload error:', uploadError);
          toast({
            title: 'Avertissement',
            description: 'Le contrat a été créé mais l\'upload du PDF a échoué. Vous pourrez l\'uploader depuis la page du contrat.',
            variant: 'destructive',
          });
        }
      }

      return result;
    },
    onSuccess: (data) => {
      toast({
        title: 'Succès',
        description: 'Contrat créé avec succès.',
      });
      setLocation(`/contracts/${data.contract.id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create contract');
    },
  });

  const onSubmit = async (data: CreateContractInput & { payment_formula: 'A' | 'B' }) => {
    setError('');

    // Validate payment method
    if (!selectedPaymentMethod && !paymentMethods?.length) {
      setError('Veuillez d\'abord ajouter une méthode de paiement');
      return;
    }

    // Validate PDF upload (required)
    if (!leaseProofFile) {
      setError('Veuillez uploader la preuve de signature du bail (PDF)');
      return;
    }

    // Validate PDF file type
    if (leaseProofFile.type !== 'application/pdf') {
      setError('Le fichier doit être un PDF');
      return;
    }

    // Validate PDF file size (max 10MB)
    if (leaseProofFile.size > 10 * 1024 * 1024) {
      setError('Le fichier PDF ne doit pas dépasser 10 MB');
      return;
    }

    const contractData = {
      ...data,
      payment_method_id: selectedPaymentMethod || undefined,
    };

    createContractMutation.mutate(contractData);
  };

  if (!isOwner) {
    return (
      <MainLayout>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">Only property owners can create contracts</p>
          <Link href="/">
            <Button data-testid="button-home">Go Home</Button>
          </Link>
        </div>
      </MainLayout>
    );
  }

  if (propertyLoading) {
    return (
      <MainLayout>
        <div className="container mx-auto px-4 py-16 text-center">
          <p>Loading property details...</p>
        </div>
      </MainLayout>
    );
  }

  if (!property) {
    return (
      <MainLayout>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-4">Property Not Found</h1>
          <Link href="/dashboard/owner">
            <Button data-testid="button-dashboard">Back to Dashboard</Button>
          </Link>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href="/dashboard/owner">
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>

        <div className="max-w-3xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Créer un contrat de location</CardTitle>
              <CardDescription>
                Créez un nouveau contrat de location pour {property.title}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="mb-6 p-4 bg-muted rounded-md">
                <h3 className="font-semibold mb-2">Détails de la propriété</h3>
                <p className="text-sm text-muted-foreground">{property.title}</p>
                <p className="text-sm text-muted-foreground">
                  {property.address}, {property.city_name}
                </p>
                <p className="font-semibold mt-2">CHF {property.price.toLocaleString()}/mois</p>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="student_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sélectionner le locataire</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(parseInt(value))}
                          value={field.value?.toString()}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-student">
                              <SelectValue placeholder="Choose a student" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {students?.map((student) => (
                              <SelectItem key={student.id} value={student.id.toString()}>
                                {student.first_name} {student.last_name} ({student.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Sélectionnez l'étudiant qui louera cette propriété
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="start_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date de début</FormLabel>
                          <FormControl>
                            <Input {...field} type="date" data-testid="input-start-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="end_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date de fin</FormLabel>
                          <FormControl>
                            <Input {...field} type="date" data-testid="input-end-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="monthly_rent"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Loyer mensuel (CHF)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              data-testid="input-monthly-rent"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="charges"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Charges mensuelles (CHF)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              data-testid="input-charges"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="deposit_amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Caution (CHF)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              data-testid="input-deposit"
                            />
                          </FormControl>
                          <FormDescription>
                            Généralement 3 mois de loyer
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Separator />

                  {/* Formula Selection */}
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="payment_formula"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-base font-semibold">Formule de commission</FormLabel>
                          <FormDescription>
                            Choisissez la formule de paiement pour ce bail. Le choix se fait à chaque bail.
                          </FormDescription>
                          <FormControl>
                            <RadioGroup
                              onValueChange={(value) => field.onChange(value as 'A' | 'B')}
                              value={field.value}
                              className="grid grid-cols-1 md:grid-cols-2 gap-4"
                            >
                              <div className="flex items-start space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted">
                                <RadioGroupItem value="A" id="formula-a" className="mt-1" />
                                <Label htmlFor="formula-a" className="flex-1 cursor-pointer">
                                  <div className="font-semibold">Formule A - Paiement unique</div>
                                  <div className="text-sm text-muted-foreground mt-1">
                                    800 CHF - Paiement unique après signature du bail
                                  </div>
                                </Label>
                              </div>
                              <div className="flex items-start space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted">
                                <RadioGroupItem value="B" id="formula-b" className="mt-1" />
                                <Label htmlFor="formula-b" className="flex-1 cursor-pointer">
                                  <div className="font-semibold">Formule B - Abonnement mensuel</div>
                                  <div className="text-sm text-muted-foreground mt-1">
                                    4% du loyer mensuel charges comprises - Paiement automatique chaque mois
                                  </div>
                                </Label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Commission Calculation Display */}
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-semibold mb-1">Commission Hoomy:</div>
                        {paymentFormula === 'A' ? (
                          <div>Montant fixe: <strong>800 CHF</strong> (paiement unique après signature)</div>
                        ) : (
                          <div>
                            Montant mensuel: <strong>{commissionAmount.toFixed(2)} CHF</strong> 
                            {' '}(4% de {totalRent.toFixed(2)} CHF = loyer {monthlyRent.toFixed(2)} CHF + charges {charges.toFixed(2)} CHF)
                            {totalRent === 0 && (
                              <span className="block text-xs text-muted-foreground mt-1">
                                Veuillez renseigner le loyer et les charges pour calculer la commission.
                              </span>
                            )}
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  </div>

                  <Separator />

                  {/* Payment Method Selection */}
                  <div className="space-y-4">
                    <div>
                      <Label className="text-base font-semibold">Méthode de paiement</Label>
                      <FormDescription>
                        Sélectionnez la carte bancaire à utiliser pour les paiements de commission
                      </FormDescription>
                    </div>
                    
                    {!paymentMethods || paymentMethods.length === 0 ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          Aucune méthode de paiement enregistrée. Veuillez en ajouter une ci-dessous.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Select value={selectedPaymentMethod} onValueChange={(value) => {
                        setSelectedPaymentMethod(value);
                        form.setValue('payment_method_id', value);
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionnez une carte" />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map((method) => (
                            <SelectItem key={method.id} value={method.id}>
                              {method.card_brand?.toUpperCase() || 'Carte'} •••• {method.card_last4}
                              {method.is_default && ' (Par défaut)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <PaymentMethodManager 
                      onPaymentMethodAdded={(paymentMethodId) => {
                        setSelectedPaymentMethod(paymentMethodId);
                        form.setValue('payment_method_id', paymentMethodId);
                        queryClient.invalidateQueries({ queryKey: ['/payment-methods'] });
                      }}
                    />
                  </div>

                  <Separator />

                  {/* PDF Upload */}
                  <div className="space-y-4">
                    <div>
                      <Label className="text-base font-semibold">Preuve de signature du bail (PDF)</Label>
                      <FormDescription>
                        Upload obligatoire du PDF du bail signé. Aucun paiement ne sera effectué sans cette preuve.
                      </FormDescription>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <Input
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setLeaseProofFile(file);
                          }
                        }}
                        className="flex-1"
                      />
                      {leaseProofFile && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          {leaseProofFile.name} ({(leaseProofFile.size / 1024).toFixed(1)} KB)
                        </div>
                      )}
                    </div>
                    
                    {leaseProofFile && leaseProofFile.type !== 'application/pdf' && (
                      <Alert variant="destructive">
                        <AlertDescription>Le fichier doit être un PDF</AlertDescription>
                      </Alert>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <Button
                      type="submit"
                      size="lg"
                      disabled={createContractMutation.isPending}
                      className="flex-1"
                      data-testid="button-submit"
                    >
                      {createContractMutation.isPending ? 'Création...' : 'Créer le contrat'}
                    </Button>
                    <Link href="/dashboard/owner">
                      <Button type="button" variant="outline" size="lg" data-testid="button-cancel">
                        Annuler
                      </Button>
                    </Link>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
