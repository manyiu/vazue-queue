import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vazue Queue Admin',
  description: 'Owner console for rooms, events, and live queue controls',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Deployed admin SPA: CDK writes /config.js with Cognito + API endpoints. */}
        <script src="/config.js" />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
