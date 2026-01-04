import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PaymentMethod, CreatePaymentMethodInput } from '@shared/schema';

// Note: Stripe integration will be handled via backend redirects or Stripe Elements
// For now, we'll use a redirect-based approach for Setup Intents

interface PaymentMethodManagerProps {
  onPaymentMethodAdded?: (paymentMethodId: string) => void;
  showAddButton?: boolean;
}

export function PaymentMethodManager({ onPaymentMethodAdded, showAddButton = true }: PaymentMethodManagerProps) {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [saveForFuture, setSaveForFuture] = useState(true);

  // Fetch payment methods for all authenticated users (owners and students)
  const { data: paymentMethods, isLoading } = useQuery<PaymentMethod[]>({
    queryKey: ['/payment-methods'],
    enabled: isAuthenticated,
    queryFn: async () => {
      return apiRequest<PaymentMethod[]>('GET', '/payment-methods');
    },
  });

  // Create Setup Intent and redirect to Stripe
  const createSetupIntentMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ setup_intent_id: string; client_secret: string; redirect_url?: string }>('POST', '/payment-methods/create-setup-intent', {
        save_for_future: saveForFuture,
      });
    },
    onSuccess: async (data) => {
      // If backend provides a redirect URL, use it
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }

      // Otherwise, backend will handle the Setup Intent confirmation
      // and we'll save it via the callback
      const saveData: CreatePaymentMethodInput = {
        setup_intent_id: data.setup_intent_id,
        save_for_future: saveForFuture,
      };

      savePaymentMethodMutation.mutate(saveData);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Échec de la création du Setup Intent',
        variant: 'destructive',
      });
    },
  });

  // Save payment method
  const savePaymentMethodMutation = useMutation({
    mutationFn: (data: CreatePaymentMethodInput) => {
      return apiRequest<{ success: boolean; payment_method: PaymentMethod }>('POST', '/payment-methods', data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/payment-methods'] });
      setAddDialogOpen(false);
      setSaveForFuture(true);
      
      toast({
        title: 'Succès',
        description: saveForFuture 
          ? 'Carte enregistrée avec succès pour les futurs baux'
          : 'Carte ajoutée avec succès',
      });

      if (onPaymentMethodAdded && data.payment_method) {
        onPaymentMethodAdded(data.payment_method.id);
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Échec de l\'enregistrement de la carte',
        variant: 'destructive',
      });
    },
  });

  // Delete payment method
  const deletePaymentMethodMutation = useMutation({
    mutationFn: (paymentMethodId: string) => {
      return apiRequest('DELETE', `/payment-methods/${paymentMethodId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payment-methods'] });
      toast({
        title: 'Succès',
        description: 'Méthode de paiement supprimée',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Échec de la suppression',
        variant: 'destructive',
      });
    },
  });

  // Set default payment method
  const setDefaultMutation = useMutation({
    mutationFn: (paymentMethodId: string) => {
      return apiRequest('PUT', `/payment-methods/${paymentMethodId}/set-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payment-methods'] });
      toast({
        title: 'Succès',
        description: 'Méthode de paiement par défaut mise à jour',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Échec de la mise à jour',
        variant: 'destructive',
      });
    },
  });

  // Component is now available for all authenticated users

  const handleAddPaymentMethod = () => {
    createSetupIntentMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Méthodes de paiement</CardTitle>
            <CardDescription>
              Gérez vos cartes bancaires pour les paiements
            </CardDescription>
          </div>
          {showAddButton && (
            <Button onClick={() => setAddDialogOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une carte
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Chargement...</div>
        ) : !paymentMethods || paymentMethods.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Aucune méthode de paiement enregistrée. Ajoutez une carte pour pouvoir créer des baux.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {paymentMethods.map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">
                      {method.card_brand?.toUpperCase() || 'Carte'} •••• {method.card_last4}
                    </div>
                    {method.card_exp_month && method.card_exp_year && (
                      <div className="text-sm text-muted-foreground">
                        Expire {method.card_exp_month}/{method.card_exp_year}
                      </div>
                    )}
                  </div>
                  {method.is_default && (
                    <Badge variant="default" className="ml-2">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Par défaut
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!method.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDefaultMutation.mutate(method.id)}
                      disabled={setDefaultMutation.isPending}
                    >
                      Définir par défaut
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm('Êtes-vous sûr de vouloir supprimer cette carte ?')) {
                        deletePaymentMethodMutation.mutate(method.id);
                      }
                    }}
                    disabled={deletePaymentMethodMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Payment Method Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter une carte bancaire</DialogTitle>
              <DialogDescription>
                Votre carte sera sécurisée par Stripe. Aucune information de carte n'est stockée sur nos serveurs.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Vous serez redirigé vers Stripe pour sécuriser l'ajout de votre carte.
                  Vous devrez autoriser explicitement l'enregistrement de votre carte.
                </AlertDescription>
              </Alert>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="save-for-future"
                  checked={saveForFuture}
                  onCheckedChange={(checked) => setSaveForFuture(checked === true)}
                />
                <Label htmlFor="save-for-future" className="cursor-pointer">
                  Sauvegarder cette carte pour les futurs baux
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleAddPaymentMethod}
                disabled={createSetupIntentMutation.isPending || savePaymentMethodMutation.isPending}
              >
                {createSetupIntentMutation.isPending || savePaymentMethodMutation.isPending
                  ? 'Traitement...'
                  : 'Continuer avec Stripe'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

