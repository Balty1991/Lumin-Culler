import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RescueApp } from './RescueApp';

beforeEach(() => {
  localStorage.clear();
});

describe('RescueApp', () => {
  it('says what the app does on the first screen and hides the old culler', () => {
    render(<RescueApp />);
    expect(screen.getByRole('heading', { name: 'Eliberează spațiu, întâi ce e mai mare.' })).toBeInTheDocument();
    expect(screen.queryByText('ÎNCEPE ACUM')).not.toBeInTheDocument();
    expect(screen.queryByText(/XMP/)).not.toBeInTheDocument();
    expect(screen.queryByText('Mod Pro')).not.toBeInTheDocument();
    expect(screen.queryByText('Bibliotecă')).not.toBeInTheDocument();
    expect(screen.queryByText('Toate uneltele')).not.toBeInTheDocument();
  });

  it('walks three intro screens into a scan', () => {
    render(<RescueApp boot={{ screen: 'intro1', liveScan: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuă' }));
    expect(screen.getByRole('heading', { name: 'Ce face' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuă' }));
    expect(screen.getByRole('heading', { name: 'Cum te ajută' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scanează' }));
    expect(screen.getByText('Se măsoară spațiul')).toBeInTheDocument();
  });

  it('shows a partial gigabyte estimate on the scan screen', () => {
    render(<RescueApp boot={{ screen: 'scan', liveScan: false }} />);
    expect(screen.getByRole('heading', { name: /Deja poți elibera 2\.3 GB/ })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  });

  it('ranks piles on home and keeps the only chat copy unchecked', () => {
    render(<RescueApp boot={{ screen: 'home', liveScan: false }} />);
    expect(screen.getByText('Eliberează spațiu, întâi ce e mai mare.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Poți elibera 2\.4 GB/ })).toBeInTheDocument();
    const reviews = screen.getAllByRole('button', { name: /^Verifică / });
    expect(reviews[0]).toHaveAccessibleName('Verifică Videoclipuri mari');
    expect(reviews.map(button => button.getAttribute('aria-label'))).toEqual([
      'Verifică Videoclipuri mari',
      'Verifică Duplicate',
      'Verifică Cadre în plus din rafală',
      'Verifică WhatsApp, Telegram, Messenger',
      'Verifică Poze neclare',
      'Verifică Capturi'
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Verifică WhatsApp, Telegram, Messenger' }));
    expect(screen.getByRole('checkbox', { name: /IMG-20260111-WA0004/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /WA0091/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Mută 3 în Coș/ }));
    expect(screen.getByRole('heading', { name: /e în Coș/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anulează' }));
    expect(screen.getByRole('heading', { name: /Poți elibera/ })).toBeInTheDocument();
  });

  it('swipes without leaving the free-allowance copy, then frees space', () => {
    render(<RescueApp boot={{ screen: 'home', liveScan: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verifică Videoclipuri mari' }));
    fireEvent.click(screen.getByRole('button', { name: 'Glisează una câte una' }));
    expect(screen.getByText(/nu consumă limita gratuită/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Coș' }));
    fireEvent.click(screen.getByRole('button', { name: 'Coș' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliberează spațiul acum' }));
    expect(screen.getByText('Browserul nu a șters nimic de pe telefon.')).toBeInTheDocument();
  });

  it('limits settings to language, reminder, premium and privacy', async () => {
    render(<RescueApp boot={{ screen: 'settings', liveScan: false }} />);
    expect(await screen.findByRole('heading', { name: 'Setări' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Memento' })).toBeInTheDocument();
    expect(screen.queryByText('Mod Pro')).not.toBeInTheDocument();
    expect(screen.queryByText('Toate uneltele')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Premium' }));
    expect(await screen.findByRole('heading', { name: 'Free the rest' })).toBeInTheDocument();
    expect(screen.getByText(/pay in the browser/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$|19,99|4\.99|79,99/);
  });
});
