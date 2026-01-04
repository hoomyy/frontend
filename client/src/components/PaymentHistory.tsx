import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, CreditCard, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import type { Payment, Invoice } from '@shared/schema';
import { format } from 'date-fns';

interface PaymentHistoryProps {
  contractId: number;
  onRetryPayment?: (paymentId: number) => void;
}

export function PaymentHistory({ contractId, onRetryPayment }: PaymentHistoryProps) {
  // Fetch payments
  const { data: paymentsData, isLoading: paymentsLoading } = useQuery<{ payments: Payment[] }>({
    queryKey: ['/payments/contract', contractId],
    enabled: !!contractId,
    queryFn: async () => {
      return apiRequest<{ payments: Payment[] }>('GET', `/payments/contract/${contractId}`);
    },
  });

  // Fetch invoices
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery<{ invoices: Invoice[] }>({
    queryKey: ['/invoices/contract', contractId],
    enabled: !!contractId,
    queryFn: async () => {
      return apiRequest<{ invoices: Invoice[] }>('GET', `/invoices/contract/${contractId}`);
    },
  });

  const payments = paymentsData?.payments || [];
  const invoices = invoicesData?.invoices || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'succeeded':
      case 'paid':
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Réussi
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Échoué
          </Badge>
        );
      case 'pending':
      case 'processing':
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            En attente
          </Badge>
        );
      case 'overdue':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            En retard
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleRetryPayment = async (paymentId: number) => {
    try {
      await apiRequest('POST', `/payments/retry/${paymentId}`);
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/payments/contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['/contracts', contractId] });
    } catch (error) {
      console.error('Error retrying payment:', error);
    }
  };

  const handleDownloadInvoice = async (invoiceId: number) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'https://backend.hoomy.site'}/invoices/${invoiceId}/download`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Échec du téléchargement');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading invoice:', error);
    }
  };

  if (paymentsLoading || invoicesLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historique des paiements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (payments.length === 0 && invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historique des paiements</CardTitle>
          <CardDescription>Aucun paiement ou facture pour ce contrat</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Aucun paiement n'a encore été effectué pour ce contrat.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Payments */}
      <Card>
        <CardHeader>
          <CardTitle>Paiements</CardTitle>
          <CardDescription>Historique des paiements de commission</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">
                      {payment.formula === 'A' ? 'Formule A' : 'Formule B'} - {payment.amount.toFixed(2)} CHF
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {payment.created_at && format(new Date(payment.created_at), 'dd/MM/yyyy')}
                      {payment.paid_at && ` • Payé le ${format(new Date(payment.paid_at), 'dd/MM/yyyy')}`}
                    </div>
                    {payment.failure_reason && (
                      <div className="text-sm text-destructive mt-1">
                        Raison: {payment.failure_reason}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(payment.status)}
                  {payment.status === 'failed' && payment.retry_count < 3 && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        if (onRetryPayment) {
                          onRetryPayment(payment.id);
                        } else {
                          // Fallback: call API directly
                          handleRetryPayment(payment.id);
                        }
                      }}
                    >
                      Réessayer
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>Factures</CardTitle>
          <CardDescription>Téléchargez vos factures au format PDF</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="font-medium">
                      Facture #{invoice.invoice_number} - {invoice.amount.toFixed(2)} CHF
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {invoice.formula === 'A' ? 'Formule A' : 'Formule B'} • 
                      {' '}Émise le {invoice.issue_date && format(new Date(invoice.issue_date), 'dd/MM/yyyy')}
                      {invoice.due_date && ` • Échéance: ${format(new Date(invoice.due_date), 'dd/MM/yyyy')}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(invoice.status)}
                  {invoice.pdf_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadInvoice(invoice.id)}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Télécharger
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

