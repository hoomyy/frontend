import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearch, useLocation } from 'wouter';
import { Send, Building2, ArrowLeft, FileText, Check, X, Image as ImageIcon, XCircle } from 'lucide-react';
import { MainLayout } from '@/components/MainLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import type { Conversation, Message, Property } from '@shared/schema';
import { apiRequest } from '@/lib/api';
import { getBackendBaseURL } from '@/lib/apiConfig';
import { getAuthToken } from '@/lib/auth';
import { useLanguage } from '@/lib/useLanguage';
import { useToast } from '@/hooks/use-toast';
import { escapeHtml, sanitizeUrl, isTrustedUrl, safeOpen } from '@/lib/security';
import { analytics } from '@/lib/analytics';

export default function Messages() {
  const { user, isOwner } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const conversationIdParam = new URLSearchParams(searchParams).get('conversation');
  const propertyIdParam = new URLSearchParams(searchParams).get('property');
  const ownerIdParam = new URLSearchParams(searchParams).get('owner');

  const [selectedConversation, setSelectedConversation] = useState<number | null>(
    conversationIdParam ? parseInt(conversationIdParam) : null
  );
  const [messageText, setMessageText] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [proposeContractDialogOpen, setProposeContractDialogOpen] = useState(false);
  const [pendingContractId, setPendingContractId] = useState<number | null>(null);
  const MESSAGE_MAX_LENGTH = 500;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    if (!scrollAreaRef.current) return;
    
    // Try multiple methods to find the scrollable viewport
    let viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (!viewport) {
      viewport = scrollAreaRef.current.querySelector('.h-full.w-full') as HTMLElement;
    }
    if (!viewport) {
      viewport = scrollAreaRef.current.firstElementChild as HTMLElement;
    }
    
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  };

  const createConversationMutation = useMutation({
    mutationFn: (data: { property_id: number; owner_id: number }) =>
      apiRequest('POST', '/conversations', data),
    onSuccess: (data) => {
      setSelectedConversation(data.id);
      queryClient.invalidateQueries({ queryKey: ['/conversations'] });
    },
  });

  // Créer une conversation si nécessaire (une seule fois)
  const hasTriedCreateConversation = useRef(false);
  useEffect(() => {
    if (
      !conversationIdParam &&
      propertyIdParam &&
      ownerIdParam &&
      !selectedConversation &&
      !createConversationMutation.isPending &&
      !createConversationMutation.isSuccess &&
      !hasTriedCreateConversation.current
    ) {
      hasTriedCreateConversation.current = true;
      createConversationMutation.mutate({
        property_id: parseInt(propertyIdParam),
        owner_id: parseInt(ownerIdParam),
      });
    }
    // Reset si les paramètres changent
    if (!propertyIdParam || !ownerIdParam) {
      hasTriedCreateConversation.current = false;
    }
  }, [conversationIdParam, propertyIdParam, ownerIdParam, selectedConversation, createConversationMutation]);

  const { data: conversationsData, isLoading: conversationsLoading } = useQuery<any>({
    queryKey: ['/conversations'],
    queryFn: async () => {
      const response = await apiRequest<any>('GET', '/conversations');
      // Gérer les deux formats: tableau direct ou { conversations: [...] }
      if (Array.isArray(response)) return response;
      if (response?.conversations && Array.isArray(response.conversations)) return response.conversations;
      return [];
    },
    refetchInterval: 10000, // Poll for new conversations every 10 seconds (reduced frequency)
  });

  // S'assurer que conversations est toujours un tableau
  const conversations: Conversation[] = Array.isArray(conversationsData) ? conversationsData : [];

  const { data: messagesData, isLoading: messagesLoading } = useQuery<any>({
    queryKey: ['/messages', selectedConversation],
    enabled: !!selectedConversation,
    queryFn: async () => {
      if (!selectedConversation) return [];
      const response = await apiRequest<any>('GET', `/messages/${selectedConversation}`);
      // Gérer les deux formats: tableau direct ou { messages: [...] }
      if (Array.isArray(response)) return response;
      if (response?.messages && Array.isArray(response.messages)) return response.messages;
      return [];
    },
    refetchInterval: 5000, // Poll for new messages every 5 seconds (reduced frequency)
  });

  // S'assurer que messages est toujours un tableau
  const messages: Message[] = Array.isArray(messagesData) ? messagesData : [];

  const sendMessageMutation = useMutation({
    mutationFn: (data: { conversation_id: number; content?: string; image_url?: string }) =>
      apiRequest('POST', '/messages', data),
    onSuccess: (_, variables) => {
      // Track message sent
      analytics.message(
        variables.image_url ? 'send_image' : 'send_message', 
        variables.conversation_id,
        { hasImage: !!variables.image_url, contentLength: variables.content?.length || 0 }
      );
      
      setMessageText('');
      setSelectedImage(null);
      setImagePreview(null);
      queryClient.invalidateQueries({ queryKey: ['/messages', selectedConversation] });
      queryClient.invalidateQueries({ queryKey: ['/conversations'] });
      // Scroll to bottom after sending message
      setTimeout(() => {
        scrollToBottom();
      }, 200);
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('image', file);
      
      const token = getAuthToken();
      if (!token) {
        throw new Error('Authentification requise. Veuillez vous reconnecter.');
      }
      
      const backendBaseURL = getBackendBaseURL();
      const response = await fetch(`${backendBaseURL}/api/upload/message-image`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
        credentials: 'include', // Important pour les requêtes cross-origin
      });
      
      if (!response.ok) {
        let errorMessage = 'Erreur lors de l\'upload';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Si la réponse n'est pas du JSON, utiliser le message par défaut
        }
        throw new Error(errorMessage);
      }
      
      return response.json();
    },
  });

  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // Only scroll if we have messages and the scroll area is mounted
    if (messages && messages.length > 0) {
      // Clear any pending scroll
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      // Use setTimeout to ensure DOM has updated
      scrollTimeoutRef.current = setTimeout(() => {
        scrollToBottom();
        scrollTimeoutRef.current = null;
      }, 100);
    }
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [messages]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'Fichier trop volumineux',
        description: 'L\'image ne peut pas dépasser 5MB.',
        variant: 'destructive',
      });
      return;
    }

    // Vérifier le type MIME strictement
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Type de fichier invalide',
        description: 'Veuillez sélectionner une image (JPEG, PNG, GIF ou WebP).',
        variant: 'destructive',
      });
      return;
    }

    // Vérifier l'extension du fichier
    const fileName = file.name.toLowerCase();
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!hasValidExtension) {
      toast({
        title: 'Extension invalide',
        description: 'L\'extension du fichier n\'est pas autorisée.',
        variant: 'destructive',
      });
      return;
    }

    // Vérifier que le fichier n'est pas vide
    if (file.size === 0) {
      toast({
        title: 'Fichier vide',
        description: 'Le fichier sélectionné est vide.',
        variant: 'destructive',
      });
      return;
    }

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Vérifier que le résultat est bien une data URL d'image
      if (result && result.startsWith('data:image/')) {
        setImagePreview(result);
      } else {
        toast({
          title: 'Erreur de lecture',
          description: 'Impossible de lire le fichier image.',
          variant: 'destructive',
        });
      }
    };
    reader.onerror = () => {
      toast({
        title: 'Erreur de lecture',
        description: 'Une erreur est survenue lors de la lecture du fichier.',
        variant: 'destructive',
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async () => {
    if (!selectedConversation) return;
    
    // Le message doit avoir soit du texte, soit une image
    if (!messageText.trim() && !selectedImage) {
      toast({
        title: 'Message vide',
        description: 'Veuillez ajouter du texte ou une image.',
        variant: 'destructive',
      });
      return;
    }

    if (messageText.length > MESSAGE_MAX_LENGTH) {
      toast({
        title: 'Message trop long',
        description: `Le message ne peut pas dépasser ${MESSAGE_MAX_LENGTH} caractères.`,
        variant: 'destructive',
      });
      return;
    }

    let imageUrl: string | undefined = undefined;

    // Upload l'image si elle existe
    if (selectedImage) {
      setUploadingImage(true);
      try {
        const uploadResult = await uploadImageMutation.mutateAsync(selectedImage);
        imageUrl = uploadResult.url;
      } catch (error: any) {
        toast({
          title: 'Erreur upload',
          description: error.message || 'Impossible d\'uploader l\'image.',
          variant: 'destructive',
        });
        setUploadingImage(false);
        return;
      }
      setUploadingImage(false);
    }

    // Valider l'URL de l'image si elle existe
    let safeImageUrl: string | undefined = undefined;
    if (imageUrl) {
      const sanitized = sanitizeUrl(imageUrl);
      if (sanitized && (isTrustedUrl(imageUrl) || imageUrl.startsWith('data:image/') || imageUrl.startsWith('blob:'))) {
        safeImageUrl = sanitized;
      } else {
        toast({
          title: 'URL invalide',
          description: 'L\'URL de l\'image n\'est pas sécurisée.',
          variant: 'destructive',
        });
        return;
      }
    }

    // Le backend va sanitizer le contenu, on envoie le texte brut
    sendMessageMutation.mutate({
      conversation_id: selectedConversation,
      content: messageText.trim() || undefined,
      image_url: safeImageUrl,
    });
  };

  const handleMessageTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let value = e.target.value;
    
    // Supprimer les caractères de contrôle dangereux
    value = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    if (value.length <= MESSAGE_MAX_LENGTH) {
      setMessageText(value);
    } else {
      // Limiter à la longueur maximale
      setMessageText(value.slice(0, MESSAGE_MAX_LENGTH));
      toast({
        title: 'Limite atteinte',
        description: `Le message ne peut pas dépasser ${MESSAGE_MAX_LENGTH} caractères.`,
        variant: 'destructive',
      });
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 128)}px`;
    }
  }, [messageText]);

  // Trouver la conversation sélectionnée de manière sécurisée
  const selectedConvData = Array.isArray(conversations) 
    ? conversations.find(c => c.id === selectedConversation) 
    : undefined;

  // Récupérer les informations de la propriété pour le contrat
  const { data: property } = useQuery<Property>({
    queryKey: ['/properties', selectedConvData?.property_id],
    enabled: !!selectedConvData?.property_id && !!isOwner,
    queryFn: async () => {
      if (!selectedConvData?.property_id) throw new Error('Property ID required');
      return apiRequest<Property>('GET', `/properties/${selectedConvData.property_id}`);
    },
  });

  // Vérifier s'il existe déjà un contrat pour cette conversation
  const { data: existingContract } = useQuery<any>({
    queryKey: ['/contracts/by-conversation', selectedConversation],
    enabled: !!selectedConversation,
    queryFn: async () => {
      if (!selectedConversation) return null;
      try {
        return await apiRequest<any>('GET', `/contracts/by-conversation/${selectedConversation}`);
      } catch {
        return null;
      }
    },
  });

  // Proposer un contrat
  const proposeContractMutation = useMutation({
    mutationFn: async () => {
      if (!selectedConvData?.property_id || !selectedConvData?.student_id || !property) {
        throw new Error('Informations manquantes pour créer le contrat');
      }
      
      // Calculer les dates par défaut (1 an à partir d'aujourd'hui)
      const startDate = new Date();
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1);
      
      const contractData = {
        property_id: selectedConvData.property_id,
        student_id: selectedConvData.student_id,
        conversation_id: selectedConversation,
        monthly_rent: property.price,
        charges: property.charges || 0,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        deposit_amount: property.price * 3, // 3 mois de loyer
      };
      
      return apiRequest<any>('POST', '/contracts/propose', contractData);
    },
    onSuccess: (data) => {
      toast({
        title: 'Contrat proposé',
        description: 'Le contrat a été proposé à l\'étudiant. Il pourra l\'accepter ou le refuser.',
      });
      setProposeContractDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/messages', selectedConversation] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/by-conversation', selectedConversation] });
      // Envoyer un message automatique
      sendMessageMutation.mutate({
        conversation_id: selectedConversation!,
        content: 'J\'ai proposé un contrat de location. Vous pouvez le consulter et l\'accepter si vous êtes d\'accord avec les conditions.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible de proposer le contrat',
        variant: 'destructive',
      });
    },
  });

  // Accepter un contrat
  const acceptContractMutation = useMutation({
    mutationFn: async (contractId: number) => {
      return apiRequest<any>('PUT', `/contracts/${contractId}/accept`, {});
    },
    onSuccess: (data, contractId) => {
      toast({
        title: 'Contrat accepté',
        description: 'Le contrat a été accepté et est maintenant actif.',
      });
      queryClient.invalidateQueries({ queryKey: ['/messages', selectedConversation] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/by-conversation', selectedConversation] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/my-contracts'] });
      setPendingContractId(null);
      // Envoyer un message automatique
      sendMessageMutation.mutate({
        conversation_id: selectedConversation!,
        content: 'J\'ai accepté le contrat. Merci !',
      });
      // Rediriger vers le détail du contrat
      setLocation(`/contracts/${contractId}`);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible d\'accepter le contrat',
        variant: 'destructive',
      });
    },
  });

  // Refuser un contrat
  const rejectContractMutation = useMutation({
    mutationFn: async (contractId: number) => {
      return apiRequest<any>('PUT', `/contracts/${contractId}/reject`, {});
    },
    onSuccess: () => {
      toast({
        title: 'Contrat refusé',
        description: 'Le contrat a été refusé.',
      });
      queryClient.invalidateQueries({ queryKey: ['/messages', selectedConversation] });
      queryClient.invalidateQueries({ queryKey: ['/contracts/by-conversation', selectedConversation] });
      setPendingContractId(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible de refuser le contrat',
        variant: 'destructive',
      });
    },
  });

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)] md:h-[calc(100vh-5rem)]">
        <div className="container mx-auto px-0 sm:px-3 md:px-4 lg:px-6 xl:px-8 py-2 sm:py-4 md:py-6 lg:py-8 flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="max-w-6xl mx-auto flex-1 flex flex-col overflow-hidden w-full min-h-0">
            {/* Header - hidden on mobile when in conversation */}
            <div className={selectedConversation ? 'mb-2 sm:mb-3 md:mb-4 lg:mb-6 px-3 sm:px-0 flex-shrink-0 hidden md:block' : 'mb-2 sm:mb-3 md:mb-4 lg:mb-6 px-3 sm:px-0 flex-shrink-0'}>
              <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold mb-0.5 sm:mb-1 md:mb-2" data-testid="text-page-title">{t('messages.title')}</h1>
              <p className="text-[10px] sm:text-xs md:text-sm lg:text-base text-muted-foreground">{t('messages.subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:gap-3 lg:gap-4 xl:gap-6 flex-1 min-h-0 overflow-hidden">
              {/* Conversations List - Full screen on mobile when no conversation selected */}
              <Card className={selectedConversation ? 'md:col-span-1 rounded-none md:rounded-lg h-full flex flex-col overflow-hidden hidden md:flex' : 'md:col-span-1 rounded-none md:rounded-lg h-full flex flex-col overflow-hidden flex'}>
                <CardHeader className="px-2.5 sm:px-4 md:px-6 pb-2 sm:pb-3 md:pb-4 flex-shrink-0">
                  <CardTitle className="text-sm sm:text-base md:text-lg">{t('messages.conversations')}</CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden min-h-0">
                  <ScrollArea className="h-full">
                    {conversationsLoading ? (
                      <div className="space-y-2 sm:space-y-3 p-2 sm:p-3 md:p-4">
                        {[1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-16 sm:h-20 w-full" />
                        ))}
                      </div>
                    ) : !conversations || conversations.length === 0 ? (
                      <div className="text-center py-6 sm:py-8 md:py-12 px-2 sm:px-3 md:px-4">
                        <Building2 className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 text-muted-foreground mx-auto mb-2 sm:mb-3 md:mb-4" />
                        <p className="text-[10px] sm:text-xs md:text-sm text-muted-foreground">{t('messages.no_conversations')}</p>
                        <Link href="/properties">
                          <Button variant="ghost" size="sm" className="mt-2 text-[10px] sm:text-xs md:text-sm h-7 sm:h-8 md:h-9" data-testid="link-browse-properties">
                            {t('messages.browse')}
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-0.5 sm:space-y-1 p-0.5 sm:p-1 md:p-2">
                        {conversations.map((conv) => (
                          <button
                            key={conv.id}
                            onClick={() => {
                              setSelectedConversation(conv.id);
                              analytics.message('open_conversation', conv.id, { 
                                propertyTitle: conv.property_title,
                                otherUser: conv.other_user_name 
                              });
                            }}
                            className={selectedConversation === conv.id ? 'w-full text-left p-2 sm:p-2.5 md:p-3 lg:p-4 rounded-md transition-colors hover-elevate active:scale-[0.98] bg-accent touch-manipulation' : 'w-full text-left p-2 sm:p-2.5 md:p-3 lg:p-4 rounded-md transition-colors hover-elevate active:scale-[0.98] touch-manipulation'}
                            data-testid={`button-conversation-${conv.id}`}
                          >
                            <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
                              <div className="h-7 w-7 sm:h-8 sm:w-8 md:h-10 md:w-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                                <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-5 md:w-5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0 overflow-hidden">
                                <h4 className="font-semibold truncate text-[11px] sm:text-xs md:text-sm">
                                  {escapeHtml(conv.property_title || '')}
                                </h4>
                                <p className="text-[9px] sm:text-[10px] md:text-xs text-muted-foreground truncate">
                                  {escapeHtml(conv.other_user_name || '')}
                                </p>
                                {conv.last_message && (
                                  <p className="text-[9px] sm:text-[10px] md:text-xs text-muted-foreground mt-0.5 sm:mt-1 break-all line-clamp-2 overflow-hidden" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                    {escapeHtml(conv.last_message)}
                                  </p>
                                )}
                              </div>
                              {conv.unread_count && conv.unread_count > 0 && (
                                <div className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-5 md:w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[8px] sm:text-[9px] md:text-[10px] lg:text-xs font-bold flex-shrink-0">
                                  {conv.unread_count}
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Messages View - Full screen on mobile when conversation selected */}
              <Card className={selectedConversation ? 'md:col-span-2 rounded-none md:rounded-lg h-full flex flex-col overflow-hidden flex' : 'md:col-span-2 rounded-none md:rounded-lg h-full flex flex-col overflow-hidden hidden md:flex'}>
                {!selectedConversation ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center py-6 sm:py-8 md:py-12 px-3 sm:px-4">
                      <Building2 className="h-10 w-10 sm:h-12 sm:w-12 md:h-16 md:w-16 text-muted-foreground mx-auto mb-2 sm:mb-3 md:mb-4" />
                      <h3 className="font-semibold text-sm sm:text-base md:text-lg mb-1 sm:mb-2">{t('messages.select_conversation')}</h3>
                      <p className="text-[10px] sm:text-xs md:text-sm text-muted-foreground">
                        {t('messages.select_conversation.desc')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <CardHeader className="border-b px-2.5 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 flex-shrink-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="md:hidden h-7 w-7 sm:h-8 sm:w-8 -ml-1 sm:-ml-2 touch-manipulation"
                          onClick={() => setSelectedConversation(null)}
                          data-testid="button-back"
                        >
                          <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-xs sm:text-sm md:text-base lg:text-lg truncate" data-testid="text-conversation-title">
                            {selectedConvData?.property_title}
                          </CardTitle>
                          <p className="text-[9px] sm:text-[10px] md:text-xs lg:text-sm text-muted-foreground truncate">
                            {selectedConvData?.other_user_name}
                          </p>
                        </div>
                        {isOwner && !existingContract && selectedConvData?.property_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProposeContractDialogOpen(true)}
                            className="hidden sm:flex gap-1.5 sm:gap-2"
                            data-testid="button-propose-contract"
                          >
                            <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden md:inline">Proposer un contrat</span>
                          </Button>
                        )}
                        {existingContract && existingContract.status === 'pending' && !isOwner && (
                          <div className="flex gap-1.5 sm:gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setPendingContractId(existingContract.id);
                                acceptContractMutation.mutate(existingContract.id);
                              }}
                              disabled={acceptContractMutation.isPending}
                              className="text-green-600 hover:text-green-700"
                            >
                              <Check className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                              <span className="hidden sm:inline">Accepter</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setPendingContractId(existingContract.id);
                                rejectContractMutation.mutate(existingContract.id);
                              }}
                              disabled={rejectContractMutation.isPending}
                              className="text-red-600 hover:text-red-700"
                            >
                              <X className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                              <span className="hidden sm:inline">Refuser</span>
                            </Button>
                          </div>
                        )}
                        {existingContract && existingContract.status === 'active' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLocation(`/contracts/${existingContract.id}`)}
                            className="gap-1.5 sm:gap-2"
                          >
                            <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">Voir le contrat</span>
                          </Button>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="p-0 flex flex-col flex-1 overflow-hidden min-h-0">
                      <ScrollArea ref={scrollAreaRef} className="flex-1 p-1.5 sm:p-2 md:p-3 lg:p-4">
                        {messagesLoading ? (
                          <div className="space-y-2 sm:space-y-3 md:space-y-4">
                            {[1, 2, 3].map((i) => (
                              <Skeleton key={i} className="h-12 sm:h-14 md:h-16 w-3/4" />
                            ))}
                          </div>
                        ) : !messages || messages.length === 0 ? (
                          <div className="text-center py-6 sm:py-8 md:py-12">
                            <p className="text-[10px] sm:text-xs md:text-sm text-muted-foreground">{t('messages.no_messages')} {t('messages.start')}</p>
                          </div>
                        ) : (
                          <div className="space-y-1.5 sm:space-y-2 md:space-y-3 lg:space-y-4">
                            {messages.map((msg) => {
                              const isOwn = msg.sender_id === user?.id;
                              return (
                                <div
                                  key={msg.id}
                                  className={isOwn ? 'flex justify-end w-full min-w-0' : 'flex justify-start w-full min-w-0'}
                                  data-testid={`message-${msg.id}`}
                                >
                                  <div
                                    className={isOwn ? 'max-w-[90%] xs:max-w-[85%] sm:max-w-[80%] md:max-w-[75%] lg:max-w-[70%] rounded-lg p-2 sm:p-2.5 md:p-3 bg-primary text-primary-foreground overflow-hidden min-w-0' : 'max-w-[90%] xs:max-w-[85%] sm:max-w-[80%] md:max-w-[75%] lg:max-w-[70%] rounded-lg p-2 sm:p-2.5 md:p-3 bg-muted overflow-hidden min-w-0'}
                                  >
                                    {msg.image_url && (() => {
                                      // Valider et sécuriser l'URL de l'image
                                      const sanitizedUrl = sanitizeUrl(msg.image_url);
                                      const isTrusted = isTrustedUrl(msg.image_url) || msg.image_url.startsWith('data:image/') || msg.image_url.startsWith('blob:');
                                      
                                      if (!sanitizedUrl || !isTrusted) {
                                        return null; // Ne pas afficher l'image si l'URL n'est pas sécurisée
                                      }
                                      
                                      return (
                                        <div className="mb-2 rounded-md overflow-hidden">
                                          <img
                                            src={sanitizedUrl}
                                            alt="Image du message"
                                            className="max-w-full h-auto max-h-[300px] object-contain cursor-pointer"
                                            onClick={() => {
                                              if (msg.image_url) {
                                                safeOpen(msg.image_url);
                                              }
                                            }}
                                            onError={(e) => {
                                              // Cacher l'image en cas d'erreur de chargement
                                              (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                            loading="lazy"
                                            crossOrigin="anonymous"
                                          />
                                        </div>
                                      );
                                    })()}
                                    {msg.content && (
                                      <p className="text-[11px] sm:text-xs md:text-sm whitespace-pre-wrap break-all leading-relaxed" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                                        {escapeHtml(msg.content)}
                                      </p>
                                    )}
                                    <p
                                      className={isOwn ? 'text-[9px] sm:text-[10px] md:text-xs mt-0.5 sm:mt-1 text-primary-foreground/70' : 'text-[9px] sm:text-[10px] md:text-xs mt-0.5 sm:mt-1 text-muted-foreground'}
                                    >
                                      {new Date(msg.created_at).toLocaleString('fr-FR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                            <div ref={messagesEndRef} />
                          </div>
                        )}
                        
                        {/* Afficher une alerte si un contrat est en attente */}
                        {existingContract && existingContract.status === 'pending' && (
                          <Alert className="m-2 sm:m-3 md:m-4">
                            <FileText className="h-4 w-4" />
                            <AlertDescription>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-semibold">
                                    {isOwner ? 'Contrat proposé en attente' : 'Contrat proposé - Action requise'}
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    {isOwner 
                                      ? 'L\'étudiant doit accepter ou refuser le contrat.'
                                      : 'Veuillez accepter ou refuser le contrat proposé.'}
                                  </p>
                                </div>
                                {!isOwner && (
                                  <div className="flex gap-2 ml-4">
                                    <Button
                                      size="sm"
                                      onClick={() => acceptContractMutation.mutate(existingContract.id)}
                                      disabled={acceptContractMutation.isPending}
                                      className="bg-green-600 hover:bg-green-700"
                                    >
                                      <Check className="h-4 w-4 mr-1" />
                                      Accepter
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => rejectContractMutation.mutate(existingContract.id)}
                                      disabled={rejectContractMutation.isPending}
                                    >
                                      <X className="h-4 w-4 mr-1" />
                                      Refuser
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </AlertDescription>
                          </Alert>
                        )}
                      </ScrollArea>

                      <div className="border-t p-1.5 sm:p-2 md:p-3 lg:p-4 bg-background flex-shrink-0 space-y-2">
                        {/* Bouton mobile pour proposer un contrat */}
                        {isOwner && !existingContract && selectedConvData?.property_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProposeContractDialogOpen(true)}
                            className="w-full sm:hidden gap-2"
                            data-testid="button-propose-contract-mobile"
                          >
                            <FileText className="h-4 w-4" />
                            Proposer un contrat
                          </Button>
                        )}
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSendMessage();
                          }}
                          className="flex flex-col gap-1.5 sm:gap-2"
                        >
                          {/* Aperçu de l'image */}
                          {imagePreview && (
                            <div className="relative inline-block max-w-[200px]">
                              <img
                                src={imagePreview}
                                alt="Aperçu"
                                className="rounded-md max-w-full h-auto max-h-[200px] object-contain"
                              />
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                                onClick={handleRemoveImage}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          <div className="flex gap-1 sm:gap-1.5 md:gap-2 items-end">
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleImageSelect}
                              className="hidden"
                              id="message-image-input"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={sendMessageMutation.isPending || uploadingImage}
                              className="h-8 w-8 sm:h-9 sm:w-9 md:h-10 md:w-10 flex-shrink-0 touch-manipulation"
                            >
                              <ImageIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </Button>
                            <div className="flex-1 relative">
                              <Textarea
                                ref={textareaRef}
                                value={messageText}
                                onChange={handleMessageTextChange}
                                placeholder={t('messages.type_message')}
                                disabled={sendMessageMutation.isPending || uploadingImage}
                                data-testid="input-message"
                                className="text-[13px] sm:text-sm md:text-base min-h-[2.5rem] max-h-[8rem] resize-none flex-1 overflow-y-auto pr-12"
                                rows={1}
                                maxLength={MESSAGE_MAX_LENGTH}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if ((messageText.trim() || selectedImage) && !sendMessageMutation.isPending && !uploadingImage && messageText.length <= MESSAGE_MAX_LENGTH) {
                                      handleSendMessage();
                                    }
                                  }
                                }}
                              />
                              <div className="absolute bottom-2 right-2 text-[10px] sm:text-xs text-muted-foreground pointer-events-none">
                                <span className={messageText.length > MESSAGE_MAX_LENGTH * 0.9 ? 'text-orange-500' : messageText.length >= MESSAGE_MAX_LENGTH ? 'text-red-500 font-semibold' : ''}>
                                  {messageText.length}/{MESSAGE_MAX_LENGTH}
                                </span>
                              </div>
                            </div>
                            <Button
                              type="submit"
                              size="icon"
                              disabled={(!messageText.trim() && !selectedImage) || sendMessageMutation.isPending || uploadingImage || messageText.length > MESSAGE_MAX_LENGTH}
                              data-testid="button-send"
                              className="h-8 w-8 sm:h-9 sm:w-9 md:h-10 md:w-10 flex-shrink-0 touch-manipulation"
                            >
                              {uploadingImage ? (
                                <div className="h-3.5 w-3.5 sm:h-4 sm:w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              )}
                            </Button>
                          </div>
                          {messageText.length >= MESSAGE_MAX_LENGTH && (
                            <p className="text-[10px] sm:text-xs text-red-500 px-1">
                              La limite de {MESSAGE_MAX_LENGTH} caractères est atteinte.
                            </p>
                          )}
                        </form>
                      </div>
                    </CardContent>
                  </>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Dialog pour proposer un contrat */}
      <Dialog open={proposeContractDialogOpen} onOpenChange={setProposeContractDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proposer un contrat</DialogTitle>
            <DialogDescription>
              Un contrat sera automatiquement généré avec les informations de la propriété. L'étudiant pourra l'accepter ou le refuser.
            </DialogDescription>
          </DialogHeader>
          {property && (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted rounded-md">
                <h4 className="font-semibold mb-2">Détails du contrat</h4>
                <div className="space-y-1 text-sm">
                  <p><span className="font-medium">Loyer mensuel:</span> CHF {property.price.toLocaleString()}</p>
                  {property.charges && (
                    <p><span className="font-medium">Charges:</span> CHF {property.charges.toLocaleString()}</p>
                  )}
                  <p><span className="font-medium">Caution:</span> CHF {(property.price * 3).toLocaleString()} (3 mois)</p>
                  <p><span className="font-medium">Durée:</span> 1 an (à partir d'aujourd'hui)</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Vous pourrez modifier le contrat après sa création si nécessaire.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposeContractDialogOpen(false)}>
              Annuler
            </Button>
            <Button 
              onClick={() => proposeContractMutation.mutate()} 
              disabled={proposeContractMutation.isPending || !property}
            >
              {proposeContractMutation.isPending ? 'Création...' : 'Proposer le contrat'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
