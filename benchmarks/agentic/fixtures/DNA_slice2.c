float PCPC(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])
{
 float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;
 if(i1+2>L0_chain[jc]) ud0=0.0;
 else  {
 c1=((y1[jc][i1-2]-y1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1])-(z1[jc][i1-2]-z1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1]));
 c2=((z1[jc][i1-2]-z1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1])-(x1[jc][i1-2]-x1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1]));
 c3=((x1[jc][i1-2]-x1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1])-(y1[jc][i1-2]-y1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1]));
 p1=((y1[jc][i1-1]-y1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2])-(z1[jc][i1-1]-z1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2]));
 p2=((z1[jc][i1-1]-z1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2])-(x1[jc][i1-1]-x1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2]));
 p3=((x1[jc][i1-1]-x1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2])-(y1[jc][i1-1]-y1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2]));
 e1=sqrt(c1*c1+c2*c2+c3*c3); f1=sqrt(p1*p1+p2*p2+p3*p3);
 pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);
 g1=(x1[jc][i1-2]-x1[jc][i1+2]); g2=(y1[jc][i1-2]-y1[jc][i1+2]); g3=(z1[jc][i1-2]-z1[jc][i1+2]);
 gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);
 if (pp1<=-1.0) {di=-3.14;}
 else if (pp1>=1.0) {di=0.;}
 else if (hh1>=0.) {di=acos(pp1);}
 else {di=-acos(pp1);}
 ud0=kpcpc*((1-cos(di-dpcpc))+0.5*(1-cos(3.*(di-dpcpc)))); }
 return ud0;
}
float CPCP(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])
{
 float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;
 if(i1+2>L0_chain[jc]) ud0=0.0;
 else  {
 c1=((y1[jc][i1-1]-y1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2])-(z1[jc][i1-1]-z1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2]));
 c2=((z1[jc][i1-1]-z1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2])-(x1[jc][i1-1]-x1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2]));
 c3=((x1[jc][i1-1]-x1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2])-(y1[jc][i1-1]-y1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2]));
 p1=((y1[jc][i1+1]-y1[jc][i1+2])*(z1[jc][i1+2]-z1[jc][i1+4])-(z1[jc][i1+1]-z1[jc][i1+2])*(y1[jc][i1+2]-y1[jc][i1+4]));
 p2=((z1[jc][i1+1]-z1[jc][i1+2])*(x1[jc][i1+2]-x1[jc][i1+4])-(x1[jc][i1+1]-x1[jc][i1+2])*(z1[jc][i1+2]-z1[jc][i1+4]));
 p3=((x1[jc][i1+1]-x1[jc][i1+2])*(y1[jc][i1+2]-y1[jc][i1+4])-(y1[jc][i1+1]-y1[jc][i1+2])*(x1[jc][i1+2]-x1[jc][i1+4]));
 e1=sqrt(c1*c1+c2*c2+c3*c3); f1=sqrt(p1*p1+p2*p2+p3*p3);
 pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);
 g1=(x1[jc][i1-1]-x1[jc][i1+4]); g2=(y1[jc][i1-1]-y1[jc][i1+4]); g3=(z1[jc][i1-1]-z1[jc][i1+4]);
 gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);
 if (pp1<=-1.0) {di=-3.14;}
 else if (pp1>=1.0) {di=0.;}
 else if (hh1>=0.) {di=acos(pp1);}
 else {di=-acos(pp1);}
 ud0=kcpcp*((1-cos(di-dcpcp))+0.5*(1-cos(3.*(di-dcpcp))));  }
 return ud0;
}
float CPCN(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])
{
 float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;
 if(i1-4<0) ud0=0.0;
 else  {
 c1=((y1[jc][i1-4]-y1[jc][i1-2])*(z1[jc][i1-2]-z1[jc][i1-1])-(z1[jc][i1-4]-z1[jc][i1-2])*(y1[jc][i1-2]-y1[jc][i1-1]));
 c2=((z1[jc][i1-4]-z1[jc][i1-2])*(x1[jc][i1-2]-x1[jc][i1-1])-(x1[jc][i1-4]-x1[jc][i1-2])*(z1[jc][i1-2]-z1[jc][i1-1]));
 c3=((x1[jc][i1-4]-x1[jc][i1-2])*(y1[jc][i1-2]-y1[jc][i1-1])-(y1[jc][i1-4]-y1[jc][i1-2])*(x1[jc][i1-2]-x1[jc][i1-1]));
 p1=((y1[jc][i1-2]-y1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1])-(z1[jc][i1-2]-z1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1]));
 p2=((z1[jc][i1-2]-z1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1])-(x1[jc][i1-2]-x1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1]));
 p3=((x1[jc][i1-2]-x1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1])-(y1[jc][i1-2]-y1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1]));
 e1=sqrt(c1*c1+c2*c2+c3*c3); f1=sqrt(p1*p1+p2*p2+p3*p3);
 pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);
 g1=(x1[jc][i1-4]-x1[jc][i1]); g2=(y1[jc][i1-4]-y1[jc][i1]); g3=(z1[jc][i1-4]-z1[jc][i1]);
 gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);
 if (pp1<=-1.0) {di=-3.14;}
 else if (pp1>=1.0) {di=0.;}
 else if (hh1>=0.) {di=acos(pp1);}
 else {di=-acos(pp1);}
 ud0=kcpcN*((1-cos(di-dcpcN))+0.5*(1-cos(3.*(di-dcpcN)))); }
 return ud0;
}
float NCPC(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])
{
 float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;
 if(i1+2>L0_chain[jc]) ud0=0.0;
 else  {
 c1=((y1[jc][i1]-y1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1])-(z1[jc][i1]-z1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1]));
 c2=((z1[jc][i1]-z1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1])-(x1[jc][i1]-x1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1]));
 c3=((x1[jc][i1]-x1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1])-(y1[jc][i1]-y1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1]));
 p1=((y1[jc][i1-1]-y1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2])-(z1[jc][i1-1]-z1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2]));
 p2=((z1[jc][i1-1]-z1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2])-(x1[jc][i1-1]-x1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2]));
 p3=((x1[jc][i1-1]-x1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2])-(y1[jc][i1-1]-y1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2]));
 e1=sqrt(c1*c1+c2*c2+c3*c3);
 f1=sqrt(p1*p1+p2*p2+p3*p3);
 pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);
 g1=(x1[jc][i1]-x1[jc][i1+2]); g2=(y1[jc][i1]-y1[jc][i1+2]); g3=(z1[jc][i1]-z1[jc][i1+2]);
 gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);
 if (pp1<=-1.0) {di=-3.14;}
 else if (pp1>=1.0) {di=0.;}
 else if (hh1>=0.) {di=acos(pp1);}
 else {di=-acos(pp1);}
 ud0=kNcpc*((1-cos(di-dNcpc))+0.5*(1-cos(3.*(di-dNcpc)))); }
 return ud0;
}
