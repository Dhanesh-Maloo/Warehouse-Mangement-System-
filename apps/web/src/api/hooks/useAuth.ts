import { useMutation } from '@tanstack/react-query';
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

export function useMe() {
  const { token } = useAuth();
  return {
    enabled: !!token,
  };
}
