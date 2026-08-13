import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vazue Queue Admin',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Deployed admin SPA: CDK writes /config.js with Cognito + API endpoints. */}
        <script src="/config.js" />
      </head>
      <body style={{ fontFamily: 'IBM Plex Sans, system-ui, sans-serif', margin: 0, background: '#f7f5f2', color: '#1a1a1a' }}>
        {children}
      </body>
    </html>
  );
}
