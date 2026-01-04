import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireRole?: 'owner' | 'student' | 'admin';
  redirectTo?: string;
}

/**
 * ProtectedRoute component that checks authentication before rendering children
 * Redirects to login if user is not authenticated
 */
export function ProtectedRoute({ 
  children, 
  requireRole,
  redirectTo = '/login'
}: ProtectedRouteProps) {
  const { isAuthenticated, isOwner, isStudent, isAdmin, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAuthenticated) {
      // Save the current path to redirect after login
      const currentPath = window.location.pathname + window.location.search;
      setLocation(`${redirectTo}?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    // Check role requirement if specified
    if (requireRole) {
      if (requireRole === 'admin' && !isAdmin) {
        setLocation('/');
        return;
      }
      if (requireRole === 'owner' && !isOwner) {
        // Redirect based on user role
        if (user?.role === 'admin') {
          setLocation('/admin/dashboard');
        } else if (user?.role === 'student') {
          setLocation('/profile');
        } else {
          setLocation('/');
        }
        return;
      }
      if (requireRole === 'student' && !isStudent) {
        // Redirect based on user role
        if (user?.role === 'admin') {
          setLocation('/admin/dashboard');
        } else if (user?.role === 'owner') {
          setLocation('/dashboard/owner');
        } else {
          setLocation('/');
        }
        return;
      }
    }
  }, [isAuthenticated, isOwner, isStudent, isAdmin, requireRole, setLocation, redirectTo, user?.role]);

  // Show loading skeleton while checking authentication
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md p-8">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // Check role requirement
  if (requireRole) {
    if (requireRole === 'admin' && !isAdmin) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="space-y-4 w-full max-w-md p-8">
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      );
    }
    if (requireRole === 'owner' && !isOwner) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="space-y-4 w-full max-w-md p-8">
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      );
    }
    if (requireRole === 'student' && !isStudent) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="space-y-4 w-full max-w-md p-8">
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}

