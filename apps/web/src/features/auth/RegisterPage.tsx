import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInvite, useRegister } from '../../api/hooks/useAuth';
import { ApiError } from '../../api/client';
import ivalueLogo from '../../assets/ivalue-logo.png';

export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const invite = useInvite(token);
  const register = useRegister();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    register.mutate({ token: token as string, password }, { onSuccess: () => void navigate('/') });
  }

  return (
    <div className="min-h-screen bg-[#1A2B3C] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src={ivalueLogo} alt="IValue" className="h-20 w-auto mx-auto mb-3" />
          <div className="text-white font-bold text-2xl tracking-tight">IValue WMS</div>
          <div className="text-[#8AA6BF] text-sm mt-1">Warehouse Management System</div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-5">
          {/* No token in the URL at all — registration only ever starts from an emailed invite link. */}
          {!token && (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Registration is by invite</h1>
              <p className="text-sm text-gray-600">
                Client accounts are set up by your account admin, who&rsquo;ll email you a link to
                set your password. If you&rsquo;re expecting one and haven&rsquo;t received it,
                contact your account manager or{' '}
                <a href="mailto:sales.bo@ivalueindia.com" className="text-[#E86F2C] underline">
                  sales.bo@ivalueindia.com
                </a>
                .
              </p>
              <Link
                to="/login"
                className="block text-center text-sm font-semibold text-[#E86F2C] hover:text-[#D05E1E] pt-1"
              >
                Back to sign in
              </Link>
            </>
          )}

          {token && invite.isLoading && (
            <p className="text-sm text-gray-500 py-4 text-center">Checking your invite…</p>
          )}

          {token && invite.isError && (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Invite link not valid</h1>
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                {invite.error instanceof ApiError
                  ? invite.error.message
                  : 'Something went wrong checking this link.'}
              </div>
              <Link
                to="/login"
                className="block text-center text-sm font-semibold text-[#E86F2C] hover:text-[#D05E1E] pt-1"
              >
                Back to sign in
              </Link>
            </>
          )}

          {token && invite.data && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Set your password</h1>
                <p className="text-sm text-gray-500 mt-1">
                  {invite.data.email} · {invite.data.clientName}
                </p>
              </div>

              {(formError || register.error) && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  {formError ||
                    (register.error instanceof ApiError
                      ? register.error.message
                      : 'Something went wrong.')}
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700" htmlFor="password">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] focus:border-transparent"
                />
              </div>

              <div className="space-y-1">
                <label
                  className="block text-sm font-medium text-gray-700"
                  htmlFor="confirm-password"
                >
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] focus:border-transparent"
                />
              </div>

              <button
                type="submit"
                disabled={register.isPending}
                className="w-full bg-[#E86F2C] hover:bg-[#D05E1E] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {register.isPending ? 'Setting up your account…' : 'Activate account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
