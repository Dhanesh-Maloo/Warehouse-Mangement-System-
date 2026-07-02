import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../../api/hooks/useAuth';
import ivalueLogo from '../../assets/ivalue-logo.png';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const login = useLogin();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: () => void navigate('/'),
      },
    );
  }

  return (
    <div className="min-h-screen bg-[#1A2B3C] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src={ivalueLogo} alt="iValue" className="h-20 w-auto mx-auto mb-3 rounded-lg" />
          <div className="text-white font-bold text-2xl tracking-tight">IValue WMS</div>
          <div className="text-[#8AA6BF] text-sm mt-1">Warehouse Management System</div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-8 space-y-5">
          <h1 className="text-xl font-semibold text-gray-900">Sign in</h1>

          {login.error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {login.error.message}
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] focus:border-transparent"
              placeholder="you@ivalueindia.com"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full bg-[#E86F2C] hover:bg-[#D05E1E] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
