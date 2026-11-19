import { useState } from 'react'
import { cn } from '../cn'

/**
 * Photographic imagery, framed to sit inside the clinical palette.
 *
 * Degrades to nothing: if the file is absent (404) the component removes
 * itself rather than leaving a broken-image box or a grey placeholder, so
 * the layout is always valid whether or not the asset has been added.
 *
 * `tone` applies a light desaturation + palette-tinted overlay. Raw stock
 * photography tends to fight a tuned UI palette; this pulls it back toward
 * the workspace without looking like a filter.
 */
export function ClinicalImage({
  src,
  alt,
  aspect = '16 / 9',
  tone = 'cool',
  className,
  imgClassName,
  overlay,
  priority = false,
}: {
  src: string
  /** Required. Decorative use should pass an empty string explicitly. */
  alt: string
  aspect?: string
  /**
   * `muted` is for image *groups* — a row of photos from different sources
   * will clash on hue and saturation. It pulls them to a common temperature
   * so the set reads as one design decision rather than three stock photos.
   */
  tone?: 'cool' | 'neutral' | 'muted' | 'none'
  className?: string
  imgClassName?: string
  /** Content laid over the image (already contrast-protected by a scrim). */
  overlay?: React.ReactNode
  priority?: boolean
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    <figure
      className={cn('relative overflow-hidden rounded-[14px] border border-border bg-subtle', className)}
      style={{ aspectRatio: aspect }}
    >
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
        className={cn(
          'h-full w-full object-cover',
          tone === 'cool' && 'saturate-[0.85]',
          tone === 'neutral' && 'saturate-[0.6]',
          tone === 'muted' && 'saturate-[0.42] contrast-[1.06] brightness-[1.02]',
          imgClassName,
        )}
      />

      {/* Palette tint — keeps photography from clashing with the UI hues. */}
      {tone !== 'none' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{
            background:
              tone === 'cool'
                ? 'linear-gradient(150deg, rgb(11 110 99 / 0.14), rgb(19 73 184 / 0.10))'
                : tone === 'muted'
                  ? 'linear-gradient(150deg, rgb(11 110 99 / 0.30), rgb(19 73 184 / 0.24))'
                  : 'linear-gradient(150deg, rgb(11 18 32 / 0.06), transparent)',
          }}
        />
      )}

      {overlay && (
        <>
          {/* Scrim so overlaid text keeps AA contrast over any photo. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0b1220]/75 via-[#0b1220]/25 to-transparent"
          />
          <figcaption className="absolute inset-x-0 bottom-0 p-5">{overlay}</figcaption>
        </>
      )}
    </figure>
  )
}
