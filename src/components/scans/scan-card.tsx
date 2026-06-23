import Link from 'next/link'
import { ImageIcon } from 'lucide-react'
import { scanTitle, scanSummary, type Scan } from '@/lib/scans'
import { Card } from '@/components/ui/card'

/** A single space in the "My Spaces" list. Server-rendered; `photoUrl` is pre-signed. */
export function ScanCard({ scan, photoUrl }: { scan: Scan; photoUrl: string | null }) {
  return (
    <Link href={`/scans/${scan.short_code}`} className="block">
      <Card className="flex items-center gap-4 overflow-hidden p-3 transition-colors hover:border-accent">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-secondary">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-serif text-lg">{scanTitle(scan)}</p>
          <p className="truncate text-sm text-muted-foreground">{scanSummary(scan)}</p>
        </div>
      </Card>
    </Link>
  )
}
