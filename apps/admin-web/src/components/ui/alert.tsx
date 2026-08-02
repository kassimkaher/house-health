import { ApiError } from "@/lib/api";

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Array.isArray(error.body.fields)
      ? (error.body.fields as Array<{ path: string; message: string }>)
          .map((f) => `${f.path}: ${f.message}`)
          .join("; ")
      : null;
    return fields ? `${error.code} — ${fields}` : `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {messageFor(error)}
    </div>
  );
}
