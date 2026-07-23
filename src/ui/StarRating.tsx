import { useState } from 'react';
import { StarIcon } from './icons';

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

  return (
    <div
      className={`star-rating star-rating-${size}`}
      onMouseLeave={() => setHover(null)}
      role="radiogroup"
      aria-label="Rating"
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className="star-rating-btn"
          role="radio"
          aria-checked={rating === n}
          aria-label={`${n} ${n > 1 ? 'stele' : 'stea'}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onRate(rating === n ? 0 : n)}
        >
          <StarIcon fill={n <= display ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}
