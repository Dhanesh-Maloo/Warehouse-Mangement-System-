import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { useAuth } from '../../lib/auth';
import type { AuthUser } from '../../lib/auth';

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

interface LoginPayload {
  email: string;
  password: string;
}

export function useLogin() {
  const { login } = useAuth();

  return useMutation({
    mutationFn: (payload: LoginPayload) => api.post<LoginResponse>('/auth/login', payload),
    onSuccess: (data) => {
      login(data.accessToken, data.user);
    },
  });
}

interface InviteDetails {
  email: string;
  fullName: string;
  clientName: string;
}

/** Validates an invite token and fetches who it's for, without consuming it. */
export function useInvite(token: string | null) {
  return useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InviteDetails>(`/auth/invite/${encodeURIComponent(token as string)}`),
    enabled: !!token,
    retry: false,
  });
}

interface RegisterPayload {
  token: string;
  password: string;
}

/** Consumes an invite token, sets the password, and logs the user straight in. */
export function useRegister() {
  const { login } = useAuth();

  return useMutation({
    mutationFn: (payload: RegisterPayload) => api.post<LoginResponse>('/auth/register', payload),
    onSuccess: (data) => {
      login(data.accessToken, data.user);
    },
  });
}

export function useMe() {
  const { token } = useAuth();
  return {
    enabled: !!token,
  };
}
