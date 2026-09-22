'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { registerSchema } from '@linkpulse/shared';
import type { RegisterInput } from '@linkpulse/shared';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { emptyToUndefined } from '../../../lib/zodHelpers';
import { CaptchaField, captchaRequired } from '../../../components/CaptchaField';
import { OAuthButtons } from '../../../components/OAuthButtons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';

// registerSchema's own name field, not registerSchema directly: an untouched
// optional field submits "", which name's min(1) would otherwise reject the
// same way it rejects any too-short name - see lib/zodHelpers.ts.
export const formSchema = registerSchema.extend({
  name: z.preprocess(emptyToUndefined, registerSchema.shape.name),
});

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(formSchema) });

  async function onSubmit(input: RegisterInput) {
    setFormError(null);
    if (captchaRequired && !captchaToken) {
      setFormError('Please complete the captcha above.');
      return;
    }
    try {
      await registerUser(input, captchaToken);
      router.push('/dashboard');
    } catch (error) {
      // The token is single-use: a failed submit must not be retried with it.
      setCaptchaToken(null);
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong.');
    }
  }

  return (
    <Card>
      <h1 className="mb-6 text-xl font-semibold">Create your account</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <Input
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
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
          autoComplete="new-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <CaptchaField onToken={setCaptchaToken} />
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <Button type="submit" isLoading={isSubmitting}>
          Create account
        </Button>
      </form>
      <div className="mt-4">
        <OAuthButtons />
      </div>
      <p className="mt-4 text-sm text-gray-600">
        Already have an account?{' '}
        <Link href="/login" className="text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
