// v2.7: miundo ya Stakabadhi ya Fedha — chama kinachagua (Mipangilio → Nyaraka), inahifadhiwa kwenye amcos.doc_theme
export type ReceiptTheme = 'KIJANI' | 'SAFI' | 'RASMI';
export const RECEIPT_THEMES: { key: ReceiptTheme; label: string; desc: string }[] = [
  { key: 'KIJANI', label: 'Kijani', desc: 'Kichwa cha kijani chenye nembo — cha kisasa na kinachovutia' },
  { key: 'SAFI', label: 'Safi', desc: 'Nyeupe, mistari myembamba — inaokoa wino wa printa' },
  { key: 'RASMI', label: 'Rasmi', desc: 'Fremu mbili, muhuri na maandishi ya usalama — kama hati ya serikali' },
];
