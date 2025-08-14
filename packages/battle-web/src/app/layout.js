import './globals.css'

export const metadata = {
  title: 'Battle System',
  description: 'Real-time turn-based battle game',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}