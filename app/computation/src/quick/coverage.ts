import manifest from '../../../assets/computation/quick/manifest.json' with {type:'json'};

export const ESTIMATE_UNAVAILABLE = 'Estimate not available for this year.';

/** Manifest end is exclusive for selected dates; a forecast may sample that exact endpoint. */
export function coefficientRange(value: {start:string;end:string;years:Record<string,unknown>}) {
  const start=Date.parse(value.start),end=Date.parse(value.end);
  const firstYear=new Date(start).getUTCFullYear(),lastYear=new Date(end).getUTCFullYear()-1;
  const years=Object.keys(value.years ?? {});
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||
    start!==Date.UTC(firstYear,0,1)||end!==Date.UTC(lastYear+1,0,1)||
    years.length!==lastYear-firstYear+1||years.some(y=>!/^\d{4}$/.test(y)||Number(y)<firstYear||Number(y)>lastYear))
    throw new Error('Invalid coefficient manifest range');
  return {start,end,firstYear,lastYear};
}

export const QUICK_RANGE = Object.freeze(coefficientRange(manifest));
