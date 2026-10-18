import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-navy-800 text-white hover:bg-navy-700 disabled:bg-slate-400',
  secondary: 'bg-white text-navy-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-navy-800 hover:bg-slate-100 disabled:text-slate-400',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${buttonStyles[variant]} ${className}`}
    />
  );
}

export function Card({ title, description, children, className = '' }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="text-base font-semibold text-navy-800">{title}</h2>}
      {description && <p className="mt-1 text-sm text-anthracite-600">{description}</p>}
      <div className={title ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}

const alertStyles = {
  error: 'border-red-300 bg-red-50 text-red-900',
  success: 'border-teal-500 bg-teal-50 text-teal-700',
  info: 'border-violet-500 bg-violet-100 text-anthracite-800',
  warning: 'border-amber-400 bg-amber-50 text-amber-900',
} as const;

export function Alert({ kind = 'info', title, children }: { kind?: keyof typeof alertStyles; title?: string; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-md border-l-4 px-4 py-3 text-sm ${alertStyles[kind]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-sm text-anthracite-600">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
      {label}
    </div>
  );
}

export const inputClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-anthracite-800 shadow-sm placeholder:text-slate-400 aria-[invalid=true]:border-red-500';

export function TextField({ label, error, hint, className = '', ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-anthracite-700">{label}</label>
      <input id={id} {...input} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} className={inputClass} />
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-anthracite-600">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function SelectField({ label, children, className = '', ...select }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-anthracite-700">{label}</label>
      <select id={id} {...select} className={inputClass}>{children}</select>
    </div>
  );
}
