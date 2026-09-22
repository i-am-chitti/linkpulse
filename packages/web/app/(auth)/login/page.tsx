'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@linkpulse/shared';
import type { LoginInput } from '@linkpulse/shared';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { CaptchaField, captchaRequired } from '../../../components/CaptchaField';
import { OAuthButtons } from '../../../components/OAuthButtons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(input: LoginInput) {
    setFormError(null);
    if (captchaRequired && !captchaToken) {
      setFormError('Please complete the captcha above.');
      return;
    }
    try {
      await login(input, captchaToken);
      router.push('/dashboard');
    } catch (error) {
      // The token is single-use: a failed sign-in must not be retried with it.
      setCaptchaToken(null);
      // Deliberately generic on the client too: the API already returns the
      // same message for a wrong password and an unknown email, so a
      // per-field error here would just re-introduce the enumeration this
      // was designed to avoid.
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong.');
    }
  }

  return (
    <Card>
      <h1 className="mb-6 text-xl font-semibold">Sign in to LinkPulse</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <CaptchaField onToken={setCaptchaToken} />
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <Button type="submit" isLoading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <div className="mt-4">
        <OAuthButtons />
      </div>
      <p className="mt-4 text-sm text-gray-600">
        No account?{' '}
        <Link href="/register" className="text-brand hover:underline">
          Create one
        </Link>
      </p>
    </Card>
  );
}
