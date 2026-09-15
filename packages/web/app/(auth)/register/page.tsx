'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@linkpulse/shared';
import type { RegisterInput } from '@linkpulse/shared';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { OAuthButtons } from '../../../components/OAuthButtons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(input: RegisterInput) {
    setFormError(null);
    try {
      await registerUser(input);
      router.push('/dashboard');
    } catch (error) {
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
