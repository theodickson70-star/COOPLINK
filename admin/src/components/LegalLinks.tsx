import { Link } from 'react-router-dom';
import { usePrefs } from '../lib/prefs';

/** Viungo vidogo vya Masharti na Faragha (chini ya kuingia na menyu) */
export function LegalLinks() {
  const en = usePrefs().lang === 'en';
  return (
    <span className="legal-links">
      <Link to="/terms">{en ? 'Terms of Service' : 'Masharti ya Huduma'}</Link> · <Link to="/privacy">{en ? 'Privacy Policy' : 'Sera ya Faragha'}</Link>
    </span>
  );
}
