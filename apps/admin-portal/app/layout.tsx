import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vazue Queue Admin',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'IBM Plex Sans, system-ui, sans-serif', margin: 0, background: '#f7f5f2', color: '#1a1a1a' }}>
        {children}
      </body>
    </html>
  );
}
