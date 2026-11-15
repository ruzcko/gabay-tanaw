// Dataset coordinates only; astronomy and scientific visibility remain host-owned.
export const lunarRadiusM = 1737400;
export function polarPixel(latitudeDeg, longitudeDeg) {
  const latitude=latitudeDeg*Math.PI/180, longitude=longitudeDeg*Math.PI/180;
  const rho=2*lunarRadiusM*Math.tan(Math.PI/4+latitude/2);
  return [3791.5+rho*Math.sin(longitude)/20,3791.5-rho*Math.cos(longitude)/20];
}
export function terrainAxis(level, polar) {
  if(!polar)return Float32Array.from({length:level?129:33},(_,i)=>(i-(level?64:16))*(level?512:2048));
  const half=level?128:32, inner=half/2, step=level?20:80;
  const axis=new Float32Array(half*2+1), edge=inner*step;
  for(let i=1;i<=half;i++){
    const distance=i<=inner?i*step:edge*Math.pow(32768/edge,(i-inner)/(half-inner));
    axis[half+i]=distance;axis[half-i]=-distance;
  }
  return axis;
}
