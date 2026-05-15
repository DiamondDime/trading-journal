import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect('/spreads');
  redirect('/auth/login');
}
