import { useState } from 'react';
import { StarIcon } from './icons';
import { useStore } from '../state/store';
import { t } from '../i18n';

/**
 * Rating 1-5 stele — axa separata de decizia pick/respinge (ca in Lightroom).
 * Click pe steaua deja setata o sterge (revine la 0), nu doar o reconfirma.
 */
export function StarRating({ rating, onRate, size = 'md' }: {
  rating: number;
  onRate: (n: number) => void;
  size?: 'sm' | 'md';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? rating;
  const locale = useStore(s => s.locale);

  return (
    <div
      className={`star-rating star-rating-${size}`}
      onMouseLeave={() => setHover(null)}
      role="radiogroup"
      aria-label={t(locale, 'starRating.ariaLabel')}
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className="star-rating-btn"
          role="radio"
          aria-checked={rating === n}
          aria-label={t(locale, n > 1 ? 'starRating.stars' : 'starRating.star', { n })}
          onMouseEnter={() => setHover(n)}
          onClick={() => onRate(rating === n ? 0 : n)}
        >
          <StarIcon fill={n <= display ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}
