// Vipengele vinavyokuja — orodha moja inayotumiwa na dashibodi na website
import type { IconName } from '../components/icons';

/** Vipengele vinavyojengwa — vinaonekana kwenye dashibodi na website (orodha moja tu) */
export const COMING_SOON: { icon: IconName; t: string; d: string; tEn: string; dEn: string }[] = [
  { icon: 'ussd', t: 'USSD kwa simu ya kawaida', d: 'Mkulima asiye na smartphone anaangalia deni, mauzo na malipo yake kwa *namba# — bila intaneti.', tEn: 'USSD for basic phones', dEn: 'Farmers without a smartphone check debts, sales and payments with a *code# — no internet needed.' },
  { icon: 'wifiOff', t: 'App inayofanya kazi bila mtandao', d: 'Karani anasajili wakulima na kurekodi mauzo sokoni bila intaneti; data inatumwa yenyewe mtandao ukirudi.', tEn: 'Offline app', dEn: 'Clerks register farmers and record market sales without internet; data syncs when the connection returns.' },
  { icon: 'cloudRain', t: 'Ushauri wa kilimo na hali ya hewa', d: 'Taarifa za mvua, wadudu na msimu wa kupanda kwa SMS ya MKULIMA — kwa kila kijiji.', tEn: 'Weather and farming advice', dEn: 'Rain, pest and planting-season alerts by SMS from MKULIMA — for every village.' },
  { icon: 'map', t: 'Ramani za mashamba (GPS)', d: 'Kila shamba linapimwa kwa simu: makisio sahihi na ufuatiliaji (traceability) unaodaiwa na wanunuzi.', tEn: 'Farm maps (GPS)', dEn: 'Every farm mapped by phone: accurate estimates and the traceability buyers now require.' },
  { icon: 'sparkle', t: 'Uliza CoopLink (AI)', d: 'Uliza kwa Kiswahili: "Wakulima wangapi hawajalipwa?" — jibu linatoka kwenye data ya chama chako.', tEn: 'Ask CoopLink (AI)', dEn: 'Ask in Swahili: "How many farmers are unpaid?" — answered from your society\'s own data.' },
];
