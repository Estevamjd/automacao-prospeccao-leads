export default async function ErroDeAutenticacao({
  searchParams,
}: {
  // No Next 15 searchParams chega como Promise.
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold">Não consegui te autenticar</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {motivo === "sem-codigo"
            ? "O link de acesso veio incompleto. Peça um novo."
            : "O link pode ter expirado ou já ter sido usado."}
        </p>
        <a
          href="/login"
          className="mt-6 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Pedir novo link
        </a>
      </div>
    </main>
  );
}
