import { useState, useEffect, useMemo } from 'react';
import { useLocation, Link } from 'wouter';
import { 
  Shield, CheckCircle2, XCircle, Eye, Loader2, AlertTriangle, 
  Users, Home, Ban, Volume2, VolumeX, Trash2, Search, 
  Calendar, Mail, Phone, TrendingUp, FileText, Clock, 
  Filter, MoreVertical, Edit, EyeOff, CheckCircle, BarChart3,
  MousePointer, MessageSquare, Heart, LogIn, Activity
} from 'lucide-react';
import { MainLayout } from '@/components/MainLayout';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/useLanguage';
import type { AdminKYC, User, Property } from '@shared/schema';
import { Skeleton } from '@/components/ui/skeleton';
import { normalizeImageUrl } from '@/lib/imageUtils';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';

// Analytics types from backend
interface AnalyticsStats {
  totals: {
    total_events: string;
    unique_sessions: string;
    unique_users: string;
    unique_ips: string;
  };
  eventTypes: { event_type: string; count: string }[];
  dailyVisits: { day: string; page_views: string; unique_users: string; sessions: string }[];
  hourlyVisits: { hour: string; visits: string }[];
  topPages: { page: string; visits: string }[];
  deviceDistribution: { device: string; count: string }[];
  browserDistribution: { browser: string; count: string }[];
  countryDistribution: { country: string; count: string }[];
  uniqueIPs: { ip: string; country: string; city: string; visits: string; last_seen: string }[];
  actionSummary: { action_key: string; count: string }[];
}

interface AnalyticsEvent {
  id: number;
  event_type: string;
  event_category: string;
  event_action: string;
  event_label?: string;
  session_id: string;
  user_id?: number;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  page_url: string;
  device_type: string;
  browser: string;
  os: string;
  ip_address: string;
  country?: string;
  city?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type UserWithStatus = User & {
  is_banned?: boolean;
  banned_until?: string | null;
  is_muted?: boolean;
  muted_until?: string | null;
  ban_reason?: string | null;
};

export default function AdminDashboard() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedKYC, setSelectedKYC] = useState<AdminKYC | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [propertySearchQuery, setPropertySearchQuery] = useState('');
  const [userFilterRole, setUserFilterRole] = useState<string>('all');
  const [propertyFilterStatus, setPropertyFilterStatus] = useState<string>('all');
  const [logActionFilter, setLogActionFilter] = useState<string>('all');
  const [logTargetFilter, setLogTargetFilter] = useState<string>('all');
  
  // Dialogs state
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [muteDialogOpen, setMuteDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithStatus | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [banDuration, setBanDuration] = useState('7');
  const [banReason, setBanReason] = useState('');
  const [muteDuration, setMuteDuration] = useState('24');
  const [muteReason, setMuteReason] = useState('');

  // Protection d'accès
  useEffect(() => {
    if (!isAuthenticated) {
      setLocation('/login');
      return;
    }
    if (isAuthenticated && !isAdmin) {
      setLocation('/');
      setTimeout(() => {
        toast({
          title: 'Accès refusé',
          description: 'Cette page est réservée aux administrateurs.',
          variant: 'destructive',
        });
      }, 100);
    }
  }, [isAuthenticated, isAdmin, setLocation, toast]);

  // ==================== STATISTIQUES ====================
  const { data: stats } = useQuery<{ stats: { pending_count: string; approved_count: string; rejected_count: string; total_count: string } }>({
    queryKey: ['/admin/kyc/stats'],
    queryFn: async () => {
      return apiRequest('GET', '/admin/kyc/stats');
    },
    refetchInterval: 30000,
  });

  const { data: generalStats } = useQuery<{
    total_users: number;
    total_students: number;
    total_owners: number;
    total_properties: number;
    active_properties: number;
    total_contracts: number;
  }>({
    queryKey: ['/admin/stats'],
    queryFn: async () => {
      return apiRequest('GET', '/admin/stats');
    },
    refetchInterval: 60000,
  });

  // ==================== KYC ====================
  const { data: pendingKYCs, isLoading: kycLoading, refetch } = useQuery<{ kycs: AdminKYC[] }>({
    queryKey: ['/admin/kyc/pending'],
    queryFn: async () => {
      return apiRequest('GET', '/admin/kyc/pending');
    },
    refetchInterval: 30000,
  });

  // ==================== UTILISATEURS ====================
  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: UserWithStatus[] }>({
    queryKey: ['/admin/users'],
    queryFn: async () => {
      return apiRequest('GET', '/admin/users');
    },
    refetchInterval: 30000,
  });

  const filteredUsers = useMemo(() => {
    if (!usersData?.users) return [];
    let filtered = usersData.users;
    
    if (userSearchQuery) {
      const query = userSearchQuery.toLowerCase();
      filtered = filtered.filter(u => 
        u.email.toLowerCase().includes(query) ||
        u.first_name.toLowerCase().includes(query) ||
        u.last_name.toLowerCase().includes(query)
      );
    }
    
    if (userFilterRole !== 'all') {
      filtered = filtered.filter(u => u.role === userFilterRole);
    }
    
    return filtered;
  }, [usersData, userSearchQuery, userFilterRole]);

  // ==================== PROPRIÉTÉS ====================
  const { data: propertiesData, isLoading: propertiesLoading } = useQuery<{ properties: Property[] }>({
    queryKey: ['/admin/properties'],
    queryFn: async () => {
      return apiRequest('GET', '/admin/properties');
    },
    refetchInterval: 30000,
  });

  // ==================== LOGS ====================
  const { data: logsData, isLoading: logsLoading } = useQuery<{
    logs: Array<{
      id: number;
      admin_id: number;
      action_type: string;
      target_type: string;
      target_id: number | null;
      target_email: string | null;
      target_name: string | null;
      description: string;
      metadata: any;
      ip_address: string | null;
      user_agent: string | null;
      created_at: string;
      admin_email: string | null;
      admin_first_name: string | null;
      admin_last_name: string | null;
    }>;
    total: number;
    limit: number;
    offset: number;
  }>({
    queryKey: ['/admin/logs', logActionFilter, logTargetFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (logActionFilter !== 'all') params.append('action_type', logActionFilter);
      if (logTargetFilter !== 'all') params.append('target_type', logTargetFilter);
      params.append('limit', '100');
      const queryString = params.toString();
      return apiRequest('GET', `/admin/logs${queryString ? `?${queryString}` : ''}`);
    },
    refetchInterval: 30000,
  });

  // Analytics queries (ADMIN ONLY)
  const { data: analyticsStats, isLoading: analyticsStatsLoading, refetch: refetchAnalyticsStats } = useQuery<AnalyticsStats>({
    queryKey: ['/admin/analytics/stats'],
    queryFn: async () => {
      return apiRequest('GET', '/admin/analytics/stats?days=30');
    },
    enabled: activeTab === 'analytics',
    refetchInterval: 30000,
  });

  const { data: analyticsEvents, isLoading: analyticsEventsLoading, refetch: refetchAnalyticsEvents } = useQuery<{
    events: AnalyticsEvent[];
    total: number;
  }>({
    queryKey: ['/admin/analytics/events'],
    queryFn: async () => {
      return apiRequest('GET', '/admin/analytics/events?limit=50');
    },
    enabled: activeTab === 'analytics',
    refetchInterval: 30000,
  });

  // Clear analytics mutation
  const clearAnalyticsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', '/admin/analytics/clear');
    },
    onSuccess: () => {
      toast({ title: 'Analytics effacées', description: 'Toutes les données ont été supprimées.' });
      refetchAnalyticsStats();
      refetchAnalyticsEvents();
    },
    onError: () => {
      toast({ title: 'Erreur', description: 'Impossible de supprimer les analytics.', variant: 'destructive' });
    },
  });

  const filteredProperties = useMemo(() => {
    if (!propertiesData?.properties) return [];
    let filtered = propertiesData.properties;
    
    if (propertySearchQuery) {
      const query = propertySearchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.title.toLowerCase().includes(query) ||
        p.address.toLowerCase().includes(query) ||
        p.city_name?.toLowerCase().includes(query)
      );
    }
    
    if (propertyFilterStatus !== 'all') {
      filtered = filtered.filter(p => p.status === propertyFilterStatus);
    }
    
    return filtered;
  }, [propertiesData, propertySearchQuery, propertyFilterStatus]);

  // ==================== MUTATIONS ====================
  const approveMutation = useMutation({
    mutationFn: (kycId: number) => apiRequest('PUT', `/admin/kyc/${kycId}/approve`),
    onSuccess: () => {
      toast({
        title: 'KYC approuvé',
        description: 'Le KYC a été approuvé avec succès.',
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/kyc/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/admin/kyc/stats'] });
      setSelectedKYC(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ kycId, reason }: { kycId: number; reason: string }) =>
      apiRequest('PUT', `/admin/kyc/${kycId}/reject`, { reason }),
    onSuccess: () => {
      toast({
        title: 'KYC rejeté',
        description: 'Le KYC a été rejeté avec succès.',
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/kyc/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/admin/kyc/stats'] });
      setRejectDialogOpen(false);
      setRejectReason('');
      setSelectedKYC(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const banUserMutation = useMutation({
    mutationFn: ({ userId, days, reason }: { userId: number; days: number; reason: string }) =>
      apiRequest('POST', `/admin/users/${userId}/ban`, { days, reason }),
    onSuccess: () => {
      toast({
        title: 'Utilisateur banni',
        description: `L'utilisateur a été banni temporairement.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/admin/stats'] });
      setBanDialogOpen(false);
      setSelectedUser(null);
      setBanReason('');
      setBanDuration('7');
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const unbanUserMutation = useMutation({
    mutationFn: (userId: number) => apiRequest('POST', `/admin/users/${userId}/unban`),
    onSuccess: () => {
      toast({
        title: 'Utilisateur débanni',
        description: `L'utilisateur a été débanni avec succès.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/users'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const muteUserMutation = useMutation({
    mutationFn: ({ userId, hours, reason }: { userId: number; hours: number; reason: string }) =>
      apiRequest('POST', `/admin/users/${userId}/mute`, { hours, reason }),
    onSuccess: () => {
      toast({
        title: 'Utilisateur muté',
        description: `L'utilisateur a été muté temporairement.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/users'] });
      setMuteDialogOpen(false);
      setSelectedUser(null);
      setMuteReason('');
      setMuteDuration('24');
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const unmuteUserMutation = useMutation({
    mutationFn: (userId: number) => apiRequest('POST', `/admin/users/${userId}/unmute`),
    onSuccess: () => {
      toast({
        title: 'Utilisateur démuté',
        description: `L'utilisateur a été démuté avec succès.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/users'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => apiRequest('DELETE', `/admin/users/${userId}`),
    onSuccess: () => {
      toast({
        title: 'Utilisateur supprimé',
        description: `L'utilisateur a été supprimé définitivement.`,
        variant: 'destructive',
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/admin/stats'] });
      setDeleteDialogOpen(false);
      setSelectedUser(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deletePropertyMutation = useMutation({
    mutationFn: (propertyId: number) => apiRequest('DELETE', `/admin/properties/${propertyId}`),
    onSuccess: () => {
      toast({
        title: 'Propriété supprimée',
        description: `La propriété a été supprimée définitivement.`,
        variant: 'destructive',
      });
      queryClient.invalidateQueries({ queryKey: ['/admin/properties'] });
      queryClient.invalidateQueries({ queryKey: ['/admin/stats'] });
      setDeleteDialogOpen(false);
      setSelectedProperty(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // ==================== HANDLERS ====================
  const handleApprove = (kyc: AdminKYC) => {
    if (confirm(`Êtes-vous sûr de vouloir approuver le KYC de ${kyc.first_name} ${kyc.last_name} ?`)) {
      approveMutation.mutate(kyc.id);
    }
  };

  const handleReject = (kyc: AdminKYC) => {
    setSelectedKYC(kyc);
    setRejectDialogOpen(true);
  };

  const submitReject = () => {
    if (!selectedKYC) return;
    if (!rejectReason.trim()) {
      toast({
        title: 'Raison requise',
        description: 'Veuillez fournir une raison de rejet.',
        variant: 'destructive',
      });
      return;
    }
    rejectMutation.mutate({ kycId: selectedKYC.id, reason: rejectReason });
  };

  const handleBanUser = (user: UserWithStatus) => {
    setSelectedUser(user);
    setBanDialogOpen(true);
  };

  const submitBan = () => {
    if (!selectedUser) return;
    if (!banReason.trim()) {
      toast({
        title: 'Raison requise',
        description: 'Veuillez fournir une raison de bannissement.',
        variant: 'destructive',
      });
      return;
    }
    banUserMutation.mutate({ 
      userId: selectedUser.id, 
      days: parseInt(banDuration), 
      reason: banReason 
    });
  };

  const handleMuteUser = (user: UserWithStatus) => {
    setSelectedUser(user);
    setMuteDialogOpen(true);
  };

  const submitMute = () => {
    if (!selectedUser) return;
    if (!muteReason.trim()) {
      toast({
        title: 'Raison requise',
        description: 'Veuillez fournir une raison de mute.',
        variant: 'destructive',
      });
      return;
    }
    muteUserMutation.mutate({ 
      userId: selectedUser.id, 
      hours: parseInt(muteDuration), 
      reason: muteReason 
    });
  };

  const handleDeleteUser = (user: UserWithStatus) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const submitDeleteUser = () => {
    if (!selectedUser) return;
    deleteUserMutation.mutate(selectedUser.id);
  };

  const handleDeleteProperty = (property: Property) => {
    setSelectedProperty(property);
    setDeleteDialogOpen(true);
  };

  const submitDeleteProperty = () => {
    if (!selectedProperty) return;
    deletePropertyMutation.mutate(selectedProperty.id);
  };

  // Ne pas afficher si pas admin
  if (!isAuthenticated || !isAdmin) {
    return null;
  }

  return (
    <MainLayout>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold">Panneau d'Administration</h1>
          </div>
          <p className="text-muted-foreground">Gestion complète de la plateforme</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
            <TabsTrigger value="users">Utilisateurs</TabsTrigger>
            <TabsTrigger value="properties">Propriétés</TabsTrigger>
            <TabsTrigger value="kyc">Vérifications KYC</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="analytics">
              <BarChart3 className="h-4 w-4 mr-1" />
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* VUE D'ENSEMBLE */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Total Utilisateurs</p>
                      <p className="text-2xl font-bold">{generalStats?.total_users || 0}</p>
                    </div>
                    <Users className="h-8 w-8 text-primary" />
                  </div>
                  <div className="mt-4 flex gap-2 text-xs">
                    <Badge variant="secondary">{generalStats?.total_students || 0} étudiants</Badge>
                    <Badge variant="secondary">{generalStats?.total_owners || 0} propriétaires</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Total Propriétés</p>
                      <p className="text-2xl font-bold">{generalStats?.total_properties || 0}</p>
                    </div>
                    <Home className="h-8 w-8 text-primary" />
                  </div>
                  <div className="mt-4">
                    <Badge variant="default" className="text-xs">
                      {generalStats?.active_properties || 0} actives
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Contrats</p>
                      <p className="text-2xl font-bold">{generalStats?.total_contracts || 0}</p>
                    </div>
                    <FileText className="h-8 w-8 text-primary" />
                  </div>
                </CardContent>
              </Card>

              {stats && (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">KYC en attente</p>
                        <p className="text-2xl font-bold text-yellow-600">{stats.stats.pending_count}</p>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-yellow-500" />
                    </div>
                    <div className="mt-4 flex gap-2 text-xs">
                      <Badge variant="outline">{stats.stats.approved_count} approuvés</Badge>
                      <Badge variant="outline">{stats.stats.rejected_count} rejetés</Badge>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Activité récente</CardTitle>
                <CardDescription>Dernières actions sur la plateforme</CardDescription>
              </CardHeader>
              <CardContent>
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertDescription>
                    Les logs d'activité seront disponibles prochainement.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          {/* GESTION DES UTILISATEURS */}
          <TabsContent value="users" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Gestion des Utilisateurs</CardTitle>
                <CardDescription>Rechercher, filtrer et gérer les utilisateurs</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4 flex-col sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher par email, nom..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={userFilterRole} onValueChange={setUserFilterRole}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filtrer par rôle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les rôles</SelectItem>
                      <SelectItem value="student">Étudiants</SelectItem>
                      <SelectItem value="owner">Propriétaires</SelectItem>
                      <SelectItem value="admin">Administrateurs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {usersLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <Alert>
                    <Users className="h-4 w-4" />
                    <AlertDescription>
                      Aucun utilisateur trouvé.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    {filteredUsers.map((user) => (
                      <Card key={user.id} className="border-2">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="font-semibold">{user.first_name} {user.last_name}</h3>
                                <Badge variant={user.role === 'admin' ? 'default' : user.role === 'owner' ? 'secondary' : 'outline'}>
                                  {user.role}
                                </Badge>
                                {user.is_banned && (
                                  <Badge variant="destructive">
                                    <Ban className="h-3 w-3 mr-1" />
                                    Banni {user.banned_until ? `jusqu'au ${new Date(user.banned_until).toLocaleDateString('fr-FR')}` : 'permanent'}
                                  </Badge>
                                )}
                                {user.is_muted && (
                                  <Badge variant="secondary">
                                    <VolumeX className="h-3 w-3 mr-1" />
                                    Muté {user.muted_until ? `jusqu'au ${new Date(user.muted_until).toLocaleDateString('fr-FR')}` : 'permanent'}
                                  </Badge>
                                )}
                                {user.email_verified && (
                                  <Badge variant="outline" className="text-green-600">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Email vérifié
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {user.email}
                                </span>
                                {user.phone && (
                                  <span className="flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {user.phone}
                                  </span>
                                )}
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Inscrit le {new Date(user.created_at).toLocaleDateString('fr-FR')}
                                </span>
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {!user.is_banned ? (
                                  <DropdownMenuItem onClick={() => handleBanUser(user)}>
                                    <Ban className="h-4 w-4 mr-2" />
                                    Bannir temporairement
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => unbanUserMutation.mutate(user.id)}>
                                    <CheckCircle2 className="h-4 w-4 mr-2" />
                                    Débannir
                                  </DropdownMenuItem>
                                )}
                                {!user.is_muted ? (
                                  <DropdownMenuItem onClick={() => handleMuteUser(user)}>
                                    <VolumeX className="h-4 w-4 mr-2" />
                                    Muter temporairement
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => unmuteUserMutation.mutate(user.id)}>
                                    <Volume2 className="h-4 w-4 mr-2" />
                                    Démuter
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteUser(user)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Supprimer définitivement
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* GESTION DES PROPRIÉTÉS */}
          <TabsContent value="properties" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Gestion des Propriétés</CardTitle>
                <CardDescription>Rechercher, filtrer et gérer les propriétés</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4 flex-col sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher par titre, adresse..."
                      value={propertySearchQuery}
                      onChange={(e) => setPropertySearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={propertyFilterStatus} onValueChange={setPropertyFilterStatus}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filtrer par statut" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les statuts</SelectItem>
                      <SelectItem value="available">Disponible</SelectItem>
                      <SelectItem value="pending">En attente</SelectItem>
                      <SelectItem value="rented">Loué</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {propertiesLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 w-full" />
                    ))}
                  </div>
                ) : filteredProperties.length === 0 ? (
                  <Alert>
                    <Home className="h-4 w-4" />
                    <AlertDescription>
                      Aucune propriété trouvée.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-4">
                    {filteredProperties.map((property) => (
                      <Card key={property.id} className="border-2">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <Link href={`/properties/${property.id}`}>
                                  <h3 className="font-semibold hover:text-primary cursor-pointer">
                                    {property.title}
                                  </h3>
                                </Link>
                                <Badge variant={property.status === 'available' ? 'default' : property.status === 'pending' ? 'secondary' : 'outline'}>
                                  {property.status}
                                </Badge>
                                <Badge variant="outline">{property.property_type}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">
                                {property.address}, {property.city_name} {property.postal_code}
                              </p>
                              <div className="flex flex-wrap gap-4 text-sm">
                                <span className="font-semibold text-primary">
                                  CHF {property.price.toLocaleString()}/mois
                                </span>
                                {property.rooms && <span>{property.rooms} pièces</span>}
                                {property.surface_area && <span>{property.surface_area} m²</span>}
                                <span className="text-muted-foreground">
                                  Créée le {new Date(property.created_at).toLocaleDateString('fr-FR')}
                                </span>
                              </div>
                              {property.first_name && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  Propriétaire: {property.first_name} {property.last_name}
                                </p>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                  <Link href={`/properties/${property.id}`}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    Voir les détails
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteProperty(property)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Supprimer définitivement
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* VÉRIFICATIONS KYC */}
          <TabsContent value="kyc" className="space-y-6">
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">En attente</p>
                        <p className="text-2xl font-bold">{stats.stats.pending_count}</p>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-yellow-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Approuvés</p>
                        <p className="text-2xl font-bold text-green-600">{stats.stats.approved_count}</p>
                      </div>
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Rejetés</p>
                        <p className="text-2xl font-bold text-red-600">{stats.stats.rejected_count}</p>
                      </div>
                      <XCircle className="h-8 w-8 text-red-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Total</p>
                        <p className="text-2xl font-bold">{stats.stats.total_count}</p>
                      </div>
                      <Shield className="h-8 w-8 text-primary" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card className="border-2 border-primary/50 bg-primary/5">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-primary" />
                      Vérifications KYC en Attente
                    </CardTitle>
                    <CardDescription>
                      Section sécurisée - Vérifiez les documents d'identité et les selfies
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="border-primary text-primary">
                    🔒 Sécurisé
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {kycLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 w-full" />
                    ))}
                  </div>
                ) : !pendingKYCs || pendingKYCs.kycs.length === 0 ? (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      Aucune vérification KYC en attente. Tous les KYC ont été traités.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-6">
                    {pendingKYCs.kycs.map((kyc) => (
                      <Card key={kyc.id} className="border-2">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div>
                              <CardTitle className="text-lg">
                                {kyc.first_name} {kyc.last_name}
                              </CardTitle>
                              <CardDescription>
                                {kyc.email} • {kyc.role} • Soumis le {new Date(kyc.submitted_at).toLocaleDateString('fr-FR')}
                              </CardDescription>
                            </div>
                            <Badge variant="secondary">En attente</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <Label className="text-sm font-medium mb-2 block">Carte d'identité - Recto</Label>
                              {kyc.id_card_front_url ? (
                                <div className="relative border rounded-lg overflow-hidden bg-muted">
                                  <img
                                    src={normalizeImageUrl(kyc.id_card_front_url)}
                                    alt="Carte d'identité recto"
                                    className="w-full h-auto max-h-64 object-contain"
                                  />
                                  <div className="absolute top-2 right-2">
                                    <Badge variant="secondary" className="bg-black/50 text-white">
                                      <Eye className="h-3 w-3 mr-1" />
                                      Recto
                                    </Badge>
                                  </div>
                                </div>
                              ) : (
                                <div className="border rounded-lg p-8 text-center text-muted-foreground">
                                  Image non disponible
                                </div>
                              )}
                            </div>

                            <div>
                              <Label className="text-sm font-medium mb-2 block">Carte d'identité - Verso</Label>
                              {kyc.id_card_back_url ? (
                                <div className="relative border rounded-lg overflow-hidden bg-muted">
                                  <img
                                    src={normalizeImageUrl(kyc.id_card_back_url)}
                                    alt="Carte d'identité verso"
                                    className="w-full h-auto max-h-64 object-contain"
                                  />
                                  <div className="absolute top-2 right-2">
                                    <Badge variant="secondary" className="bg-black/50 text-white">
                                      <Eye className="h-3 w-3 mr-1" />
                                      Verso
                                    </Badge>
                                  </div>
                                </div>
                              ) : (
                                <div className="border rounded-lg p-8 text-center text-muted-foreground">
                                  Image non disponible
                                </div>
                              )}
                            </div>

                            <div>
                              <Label className="text-sm font-medium mb-2 block">Selfie</Label>
                              {kyc.selfie_url ? (
                                <div className="relative border rounded-lg overflow-hidden bg-muted">
                                  <img
                                    src={normalizeImageUrl(kyc.selfie_url)}
                                    alt="Selfie"
                                    className="w-full h-auto max-h-64 object-contain"
                                  />
                                  <div className="absolute top-2 right-2">
                                    <Badge variant="secondary" className="bg-black/50 text-white">
                                      <Eye className="h-3 w-3 mr-1" />
                                      Selfie
                                    </Badge>
                                  </div>
                                </div>
                              ) : (
                                <div className="border rounded-lg p-8 text-center text-muted-foreground">
                                  Selfie non disponible
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2 justify-end pt-4 border-t">
                            <Button
                              variant="outline"
                              onClick={() => handleReject(kyc)}
                              disabled={approveMutation.isPending || rejectMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Rejeter
                            </Button>
                            <Button
                              onClick={() => handleApprove(kyc)}
                              disabled={approveMutation.isPending || rejectMutation.isPending}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {approveMutation.isPending ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Approbation...
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="h-4 w-4 mr-2" />
                                  Approuver
                                </>
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* LOGS */}
          <TabsContent value="logs" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Logs d'Activité</CardTitle>
                <CardDescription>Historique des actions administratives</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4 flex-col sm:flex-row">
                  <Select value={logActionFilter} onValueChange={setLogActionFilter}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Filtrer par action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toutes les actions</SelectItem>
                      <SelectItem value="kyc_approve">Approbation KYC</SelectItem>
                      <SelectItem value="kyc_reject">Rejet KYC</SelectItem>
                      <SelectItem value="user_ban">Bannissement</SelectItem>
                      <SelectItem value="user_unban">Débannissement</SelectItem>
                      <SelectItem value="user_mute">Mute</SelectItem>
                      <SelectItem value="user_unmute">Démute</SelectItem>
                      <SelectItem value="user_delete">Suppression utilisateur</SelectItem>
                      <SelectItem value="property_delete">Suppression propriété</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={logTargetFilter} onValueChange={setLogTargetFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filtrer par type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les types</SelectItem>
                      <SelectItem value="user">Utilisateurs</SelectItem>
                      <SelectItem value="property">Propriétés</SelectItem>
                      <SelectItem value="kyc">KYC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {logsLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
                ) : !logsData || logsData.logs.length === 0 ? (
                  <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertDescription>
                      Aucun log d'activité trouvé.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    {logsData.logs.map((log) => {
                      const getActionIcon = () => {
                        switch (log.action_type) {
                          case 'kyc_approve':
                            return <CheckCircle2 className="h-4 w-4 text-green-600" />;
                          case 'kyc_reject':
                            return <XCircle className="h-4 w-4 text-red-600" />;
                          case 'user_ban':
                            return <Ban className="h-4 w-4 text-red-600" />;
                          case 'user_unban':
                            return <CheckCircle2 className="h-4 w-4 text-green-600" />;
                          case 'user_mute':
                            return <VolumeX className="h-4 w-4 text-orange-600" />;
                          case 'user_unmute':
                            return <Volume2 className="h-4 w-4 text-green-600" />;
                          case 'user_delete':
                          case 'property_delete':
                            return <Trash2 className="h-4 w-4 text-red-600" />;
                          default:
                            return <FileText className="h-4 w-4 text-muted-foreground" />;
                        }
                      };

                      const getActionBadge = () => {
                        const actionLabels: Record<string, string> = {
                          'kyc_approve': 'Approbation KYC',
                          'kyc_reject': 'Rejet KYC',
                          'user_ban': 'Bannissement',
                          'user_unban': 'Débannissement',
                          'user_mute': 'Mute',
                          'user_unmute': 'Démute',
                          'user_delete': 'Suppression utilisateur',
                          'property_delete': 'Suppression propriété',
                        };
                        return actionLabels[log.action_type] || log.action_type;
                      };

                      return (
                        <Card key={log.id} className="border-l-4 border-l-primary">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  {getActionIcon()}
                                  <Badge variant="outline">{getActionBadge()}</Badge>
                                  <Badge variant="secondary">{log.target_type}</Badge>
                                </div>
                                <p className="text-sm font-medium mb-1">{log.description}</p>
                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2">
                                  <span className="flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    Admin: {log.admin_first_name && log.admin_last_name 
                                      ? `${log.admin_first_name} ${log.admin_last_name}` 
                                      : log.admin_email || 'Inconnu'}
                                  </span>
                                  {log.target_name && (
                                    <span className="flex items-center gap-1">
                                      <Eye className="h-3 w-3" />
                                      Cible: {log.target_name}
                                    </span>
                                  )}
                                  {log.target_email && (
                                    <span className="flex items-center gap-1">
                                      <Mail className="h-3 w-3" />
                                      {log.target_email}
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {new Date(log.created_at).toLocaleString('fr-FR', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                  {log.ip_address && (
                                    <span className="flex items-center gap-1">
                                      <Shield className="h-3 w-3" />
                                      IP: {log.ip_address}
                                    </span>
                                  )}
                                </div>
                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                  <details className="mt-2">
                                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                      Détails supplémentaires
                                    </summary>
                                    <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto">
                                      {JSON.stringify(log.metadata, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    {logsData.total > logsData.logs.length && (
                      <div className="text-center text-sm text-muted-foreground pt-4">
                        Affichage de {logsData.logs.length} sur {logsData.total} logs
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ANALYTICS - ADMIN ONLY - Data from backend */}
          <TabsContent value="analytics" className="space-y-6">
            {analyticsStatsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2">Chargement des analytics...</span>
              </div>
            ) : (
              <>
                {/* Stats Overview */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Sessions Uniques</CardTitle>
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{analyticsStats?.totals?.unique_sessions || 0}</div>
                      <p className="text-xs text-muted-foreground">30 derniers jours</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Utilisateurs Trackés</CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{analyticsStats?.totals?.unique_users || 0}</div>
                      <p className="text-xs text-muted-foreground">Utilisateurs connectés</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Événements</CardTitle>
                      <MousePointer className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{analyticsStats?.totals?.total_events || 0}</div>
                      <p className="text-xs text-muted-foreground">Actions trackées</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">IPs Uniques</CardTitle>
                      <Shield className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{analyticsStats?.totals?.unique_ips || 0}</div>
                      <p className="text-xs text-muted-foreground">Adresses IP détectées</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Daily Visits Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle>📈 Visites journalières</CardTitle>
                      <CardDescription>Pages vues et utilisateurs par jour</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={(analyticsStats?.dailyVisits || []).map(d => ({
                            day: new Date(d.day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }),
                            visits: parseInt(d.page_views) || 0,
                            users: parseInt(d.unique_users) || 0,
                          }))}>
                            <defs>
                              <linearGradient id="colorVisits" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="day" className="text-xs" />
                            <YAxis className="text-xs" />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--background))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px'
                              }} 
                            />
                            <Area type="monotone" dataKey="visits" stroke="#3b82f6" fill="url(#colorVisits)" name="Pages vues" />
                            <Area type="monotone" dataKey="users" stroke="#10b981" fill="url(#colorUsers)" name="Utilisateurs" />
                            <Legend />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Hourly Visits Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle>🕐 Visites par heure</CardTitle>
                      <CardDescription>Quand les utilisateurs visitent le site</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={(analyticsStats?.hourlyVisits || []).map(d => ({
                            hour: `${d.hour}h`,
                            visits: parseInt(d.visits) || 0,
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="hour" className="text-xs" />
                            <YAxis className="text-xs" />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--background))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px'
                              }} 
                            />
                            <Bar dataKey="visits" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Visites" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row 2 */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Device Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle>📱 Appareils</CardTitle>
                      <CardDescription>Distribution des types d'appareils</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px]">
                        {(analyticsStats?.deviceDistribution || []).length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={(analyticsStats?.deviceDistribution || []).map(d => ({
                                  device: d.device === 'mobile' ? '📱 Mobile' : d.device === 'tablet' ? '📱 Tablet' : '💻 Desktop',
                                  count: parseInt(d.count) || 0,
                                }))}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                dataKey="count"
                                nameKey="device"
                                label={({ device, count }) => `${device} (${count})`}
                              >
                                {(analyticsStats?.deviceDistribution || []).map((_, index) => (
                                  <Cell key={`cell-${index}`} fill={['#3b82f6', '#10b981', '#f59e0b'][index % 3]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex items-center justify-center h-full text-muted-foreground">
                            Aucune donnée
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Action Types Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle>🎯 Types d'événements</CardTitle>
                      <CardDescription>Répartition des événements</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px]">
                        {(analyticsStats?.eventTypes || []).length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={(analyticsStats?.eventTypes || []).slice(0, 6).map(d => ({
                                  name: d.event_type,
                                  value: parseInt(d.count) || 0,
                                }))}
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                dataKey="value"
                                nameKey="name"
                                label={({ name }) => name}
                              >
                                {(analyticsStats?.eventTypes || []).slice(0, 6).map((_, index) => (
                                  <Cell key={`cell-${index}`} fill={['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'][index % 6]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex items-center justify-center h-full text-muted-foreground">
                            Aucune donnée
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Browser Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle>🌐 Navigateurs</CardTitle>
                      <CardDescription>Navigateurs utilisés</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {(analyticsStats?.browserDistribution || []).slice(0, 5).map((item, index) => (
                          <div key={item.browser} className="flex items-center gap-3">
                            <div className="w-20 text-sm font-medium">{item.browser || 'Unknown'}</div>
                            <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full rounded-full transition-all"
                                style={{ 
                                  width: `${(parseInt(item.count) / (parseInt(analyticsStats?.browserDistribution?.[0]?.count) || 1)) * 100}%`,
                                  backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index]
                                }}
                              />
                            </div>
                            <div className="w-12 text-sm text-right text-muted-foreground">{item.count}</div>
                          </div>
                        ))}
                        {(analyticsStats?.browserDistribution || []).length === 0 && (
                          <p className="text-center text-muted-foreground py-4">Aucune donnée</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Top Pages & Countries */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Top Pages */}
                  <Card>
                    <CardHeader>
                      <CardTitle>📄 Pages les plus visitées</CardTitle>
                      <CardDescription>Classement des pages par nombre de vues</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {(analyticsStats?.topPages || []).map((item, index) => (
                          <div key={item.page} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.page}</p>
                            </div>
                            <Badge variant="secondary">{item.visits} vues</Badge>
                          </div>
                        ))}
                        {(analyticsStats?.topPages || []).length === 0 && (
                          <p className="text-center text-muted-foreground py-4">Aucune donnée</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Countries */}
                  <Card>
                    <CardHeader>
                      <CardTitle>🌍 Pays des visiteurs</CardTitle>
                      <CardDescription>Origine géographique des utilisateurs</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {(analyticsStats?.countryDistribution || []).slice(0, 8).map((item, index) => (
                          <div key={item.country} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
                              {index + 1}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{item.country || 'Unknown'}</p>
                            </div>
                            <Badge variant="outline">{item.count}</Badge>
                          </div>
                        ))}
                        {(analyticsStats?.countryDistribution || []).length === 0 && (
                          <p className="text-center text-muted-foreground py-4">Aucune donnée géographique</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* IP Addresses Table */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>🔒 Adresses IP</CardTitle>
                      <CardDescription>Liste des IPs uniques avec localisation (ADMIN ONLY)</CardDescription>
                    </div>
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      onClick={() => clearAnalyticsMutation.mutate()}
                      disabled={clearAnalyticsMutation.isPending}
                    >
                      {clearAnalyticsMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      Effacer tout
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2 font-medium">IP</th>
                            <th className="text-left p-2 font-medium">Pays</th>
                            <th className="text-left p-2 font-medium">Ville</th>
                            <th className="text-right p-2 font-medium">Visites</th>
                            <th className="text-right p-2 font-medium">Dernière visite</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(analyticsStats?.uniqueIPs || []).slice(0, 30).map((item) => (
                            <tr key={item.ip} className="border-b hover:bg-muted/50">
                              <td className="p-2 font-mono text-xs">{item.ip}</td>
                              <td className="p-2">{item.country || '-'}</td>
                              <td className="p-2">{item.city || '-'}</td>
                              <td className="p-2 text-right">
                                <Badge variant="secondary">{item.visits}</Badge>
                              </td>
                              <td className="p-2 text-right text-muted-foreground text-xs">
                                {new Date(item.last_seen).toLocaleString('fr-FR')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(analyticsStats?.uniqueIPs || []).length === 0 && (
                        <p className="text-center text-muted-foreground py-8">Aucune adresse IP enregistrée</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Recent Events */}
                <Card>
                  <CardHeader>
                    <CardTitle>⚡ Derniers Événements</CardTitle>
                    <CardDescription>Historique en temps réel - Données de TOUS les utilisateurs</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analyticsEventsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[500px] overflow-y-auto">
                        {(analyticsEvents?.events || []).map((event) => {
                          const getEventIcon = () => {
                            switch(event.event_type) {
                              case 'page_view': return <Eye className="h-4 w-4 text-blue-500" />;
                              case 'click': return <MousePointer className="h-4 w-4 text-green-500" />;
                              case 'auth': return <LogIn className="h-4 w-4 text-purple-500" />;
                              case 'property': return <Home className="h-4 w-4 text-orange-500" />;
                              case 'message': return <MessageSquare className="h-4 w-4 text-pink-500" />;
                              case 'search': return <Search className="h-4 w-4 text-yellow-500" />;
                              case 'filter': return <Filter className="h-4 w-4 text-cyan-500" />;
                              case 'error': return <AlertTriangle className="h-4 w-4 text-red-500" />;
                              default: return <Activity className="h-4 w-4 text-gray-500" />;
                            }
                          };
                          
                          return (
                            <div key={event.id} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors">
                              <div className="mt-0.5">{getEventIcon()}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm">{event.event_action}</span>
                                  <Badge variant="outline" className="text-xs">{event.event_type}</Badge>
                                  {event.ip_address && (
                                    <Badge variant="secondary" className="text-xs font-mono">{event.ip_address}</Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                                  <span>{event.page_url || '/'}</span>
                                  {event.user_id && (
                                    <span>• User #{event.user_id} ({event.user_first_name} {event.user_last_name})</span>
                                  )}
                                  {event.country && <span>• {event.country}</span>}
                                  {event.city && <span>({event.city})</span>}
                                  {event.device_type && <span>• {event.device_type}</span>}
                                  {event.browser && <span>• {event.browser}</span>}
                                  <span>• {new Date(event.created_at).toLocaleString('fr-FR')}</span>
                                </div>
                                {event.metadata && Object.keys(event.metadata).length > 0 && (
                                  <details className="mt-2">
                                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                      Détails
                                    </summary>
                                    <pre className="mt-1 text-xs bg-background p-2 rounded overflow-auto max-w-full">
                                      {JSON.stringify(event.metadata, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {(analyticsEvents?.events || []).length === 0 && (
                          <div className="text-center py-8 text-muted-foreground">
                            Aucun événement enregistré pour le moment
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* DIALOGS */}
        {/* Dialog de rejet KYC */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rejeter le KYC</DialogTitle>
              <DialogDescription>
                Veuillez fournir une raison de rejet pour {selectedKYC?.first_name} {selectedKYC?.last_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="reject-reason">Raison du rejet *</Label>
                <Textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Ex: Photo floue, document illisible, selfie ne correspond pas..."
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setRejectDialogOpen(false);
                setRejectReason('');
              }}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={submitReject}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
              >
                {rejectMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Rejet en cours...
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 mr-2" />
                    Rejeter
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog de bannissement */}
        <Dialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bannir un utilisateur</DialogTitle>
              <DialogDescription>
                Bannir temporairement {selectedUser?.first_name} {selectedUser?.last_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="ban-duration">Durée du bannissement (jours) *</Label>
                <Select value={banDuration} onValueChange={setBanDuration}>
                  <SelectTrigger id="ban-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 jour</SelectItem>
                    <SelectItem value="3">3 jours</SelectItem>
                    <SelectItem value="7">7 jours</SelectItem>
                    <SelectItem value="14">14 jours</SelectItem>
                    <SelectItem value="30">30 jours</SelectItem>
                    <SelectItem value="90">90 jours</SelectItem>
                    <SelectItem value="365">1 an</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ban-reason">Raison du bannissement *</Label>
                <Textarea
                  id="ban-reason"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Ex: Comportement inapproprié, violation des règles..."
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setBanDialogOpen(false);
                setBanReason('');
                setBanDuration('7');
              }}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={submitBan}
                disabled={!banReason.trim() || banUserMutation.isPending}
              >
                {banUserMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Bannissement en cours...
                  </>
                ) : (
                  <>
                    <Ban className="h-4 w-4 mr-2" />
                    Bannir
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog de mute */}
        <Dialog open={muteDialogOpen} onOpenChange={setMuteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Muter un utilisateur</DialogTitle>
              <DialogDescription>
                Empêcher {selectedUser?.first_name} {selectedUser?.last_name} de publier des messages
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="mute-duration">Durée du mute (heures) *</Label>
                <Select value={muteDuration} onValueChange={setMuteDuration}>
                  <SelectTrigger id="mute-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 heure</SelectItem>
                    <SelectItem value="6">6 heures</SelectItem>
                    <SelectItem value="12">12 heures</SelectItem>
                    <SelectItem value="24">24 heures</SelectItem>
                    <SelectItem value="48">48 heures</SelectItem>
                    <SelectItem value="72">72 heures</SelectItem>
                    <SelectItem value="168">7 jours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="mute-reason">Raison du mute *</Label>
                <Textarea
                  id="mute-reason"
                  value={muteReason}
                  onChange={(e) => setMuteReason(e.target.value)}
                  placeholder="Ex: Messages inappropriés, spam..."
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setMuteDialogOpen(false);
                setMuteReason('');
                setMuteDuration('24');
              }}>
                Annuler
              </Button>
              <Button
                variant="secondary"
                onClick={submitMute}
                disabled={!muteReason.trim() || muteUserMutation.isPending}
              >
                {muteUserMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Mute en cours...
                  </>
                ) : (
                  <>
                    <VolumeX className="h-4 w-4 mr-2" />
                    Muter
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog de suppression */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmation de suppression</DialogTitle>
              <DialogDescription>
                {selectedUser 
                  ? `Êtes-vous sûr de vouloir supprimer définitivement l'utilisateur ${selectedUser.first_name} ${selectedUser.last_name} ? Cette action est irréversible.`
                  : selectedProperty
                  ? `Êtes-vous sûr de vouloir supprimer définitivement la propriété "${selectedProperty.title}" ? Cette action est irréversible.`
                  : 'Êtes-vous sûr de vouloir effectuer cette action ?'
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setDeleteDialogOpen(false);
                setSelectedUser(null);
                setSelectedProperty(null);
              }}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (selectedUser) {
                    submitDeleteUser();
                  } else if (selectedProperty) {
                    submitDeleteProperty();
                  }
                }}
                disabled={deleteUserMutation.isPending || deletePropertyMutation.isPending}
              >
                {(deleteUserMutation.isPending || deletePropertyMutation.isPending) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Suppression en cours...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Supprimer définitivement
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
