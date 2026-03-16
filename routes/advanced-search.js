// Advanced Search and Filtering Routes
const express = require('express');
const Database = require('../config');
const { authents = router;le.export
modu
;
  }
} [] }ions:optt_ [], sor], regions:roles: [n {     retur error);
rror:',ns e optioer filt'Userole.error({
    cons) (errorh atc  } c   };
 ]
    
  ion Date' } 'Verificatat', label:ified_value: 'ver   {      },
 on' 'Regi', label:ionlue: 'reg        { vae' },
'Rol:  labele: 'role', valu        {mail' },
: 'Elabelemail',   { value: '     me' },
 : 'Name', label value: 'na     {  eated' },
 Crbel: 'Date t', lareated_a'cvalue:         { [
ptions:  sort_o     s,
s: region     regionroles,
      roles: 
 eturn {  r);

     ]
      `)
 ount DESCRDER BY c    O
    egion GROUP BY r
       T NULLIS NOn ioHERE reg     W  
 sers      FROM u  unt
NT(*) as con, COUregioT DISTINCCT        SELE
 (`se.query   Databa    `),

 ESC
    t DDER BY counORe
        P BY rolOUGRrs
        OM use      FRount
  UNT(*) as cNCT role, COSELECT DISTI        `
se.query(  Databaall([
    it Promise.s] = awa, region[roles  const {
  
  try s() {terOptiontUserFilge function ncoptions
asyer filter  usion to getnctlper fu/ He
}

/}[] };
  rt_options: ], so: [ agencies],: [ [], regionses:statusypes: [],  { report_trn
    retur);rro:', errorns e optioeport filter'Rr(.erroonsole) {
    c(error
  } catch   };     ]
  on' }
  'Locatiel:ation', labalue: 'loc   { v      },
us''Stat: elatus', lab{ value: 'st     ,
   ' } Type: 'Reportype', labele: 'report_t     { valuD' },
   el: 'Case Iab l 'case_id',value:      { d' },
  ccurreDate Oabel: 't', l'occurred_a{ value: 
         },te Created''Da', label: 'created_at { value: [
       t_options: 
      sorgencies,es: agenci  a,
    gions regions: reses,
      statuses:statu
      ypes,rtTypes: repo_teport r     rn {
    retu;

 ])[]
     `) : t DESC
    DER BY coun   OR    me
 _naY lea.agency    GROUP B_id
    ssigned_lea.id = r.a ON learts rJOIN repoa
        s leagencienforcement_  FROM law_e     unt
  coT(*) asCOUNgency_name, INCT lea.aELECT DIST       Sery(`
 abase.qu' ? Date === 'adminuser.rol
      `) : [],
    unt DESC
   co    ORDER BYn
    regioROUP BY u.   G      NULL
S NOTn I u.regioERE
        WHdevice_idN d.id = r. O reports r   JOINr_id
      d.use.id = u d ONIN devices       JOs u
 OM user       FRcount
 UNT(*) as u.region, COT ECT DISTINC SEL`
       y(abase.queradmin' ? Dat.role === 'user

       `, params),DESC
      count DER BY        ORr.status
   GROUP BY er}
     ionFilt   ${regu.id
     er_id = N d.usN users u OOI  J  = d.id
    ice_id d ON r.devevices     JOIN ds r
    portM re FRO  t
     ) as counT(*status, COUNISTINCT r.   SELECT D
     (`uerybase.qta    Da
   params),
     `, DESC
 R BY count     ORDE
   type.report_BY r   GROUP 
     r}{regionFilted
        $_id = u.id.userusers u ON       JOIN id
  ce_id = d.ON r.devi devices d IN    JOr
    reports     FROM unt
    T(*) as coOUNport_type, C r.reINCTDIST SELECT      query(`
  se.Databa
      ([omise.allPres] = await ons, agencises, regiTypes, statu [report const}

      er.id);
 .push(usams     pard = ?';
 .user_i= 'WHERE dnFilter      regio{
 r') ole === 'useser.rif (uelse  } ;
   er.region)ms.push(us
      para?';ion = reg= 'WHERE u.lter  regionFi     {
 a') 'lerole ===f (user.;

    iams = []t par;
    leilter = ''egionF   let r{
 y 
  tr(user) {nserOptioFiltrtetRepoc function g
asynter options filo get reportunction tper fel
// H
 }
}ns: [] };
  sort_optioses: [],[], statu regions: rands: [],eturn { b);
    r, error:'tions errore filter operror('Devicconsole.  
   {atch (error);
  } c  }   ]
  ' }
   ner Namelabel: 'Ow', me_nawnerlue: 'o    { vas' },
    atubel: 'Sttatus', laue: 'sal   { v },
     l: 'Model' labe'model',:  value
        {and' },: 'Brabelbrand', l: '  { value     },
  e Created' label: 'Dat_at',reatede: 'c  { valu  [
    ons: ort_optis,
      s: statusetuses  staions,
    ons: reg  reginds,
    ds: brabran     eturn {
 );

    r ]   , params)
SC
      `Y count DE  ORDER B     atus
 stROUP BY d. G     
  onFilter}gi ${re      = u.id
 N d.user_id  u O  JOIN users
      vices d    FROM det
    un coOUNT(*) as, CNCT d.statusDISTIECT   SEL
      y(`quertabase.   Da
   ,
[]   `) : n
    u.regiont DESC,DER BY cou      OR  ion
.regY u     GROUP BULL
   on IS NOT NERE u.regi      WH
  .user_idid = dN u.ices d O   JOIN dev
     users u  FROM t
      as counn, COUNT(*) CT u.regioSTIN   SELECT DI     ry(`
tabase.quein' ? Da== 'adme = user.rol
     params),

      `,  d.brandSC,DEunt R BY co     ORDE
    BY d.brandUP GRO       ter}
{regionFil $     d
  id = u.iuser_u ON d.rs  useJOIN
        vices d     FROM des count
   UNT(*) a, COndrad.b DISTINCT   SELECT(`
      abase.query[
      DatPromise.all( = await uses]statgions, ands, re   const [br }

 ;
   user.id)ush(    params.pd = ?';
  ERE d.user_iilter = 'WH  regionF{
    === 'user') user.role if (e   } els;
  user.region)s.push(am      par = ?';
.region = 'WHERE uiltergionF{
      relea') = 'ser.role ==   if (u];

 = [ let params 
   ';ter = 'gionFil  let re{
  ry ) {
  tOptions(usereviceFilterion getDync functtions
aslter opt device fin to gelper functio// He }
});

arch' });
 e se sav'Failed toon({ error: 00).js.status(5es    r;
', error)error:search or('Save .erroleonsor) {
    ccatch (err  } });

 name
    me: search_nally',
     successfu saved age: 'Searchss  merue,
    success: t
        res.json({

  
    );req.ip
      n
      },descriptioription:         desc filters,
lters:  fie,
      h_typ searcpe: search_ty
        name: name,   
      {ull,
      nl,
        nul
  arches',   'saved_seVED',
    'SEARCH_SA     .id,
 req.userit(
     se.logAudabaait Dat  awt log it
  or now, jus
    // Fse tabletabadahis to a ave tyou would s, ementationull impl/ In a f}

    /
        });uired'
  e req filters ar and type,e, searchor: 'Nam err       {
(400).json(statuses.n r retur    
 {) rs| !filteh_type |rceae || !sam  if (!n
  q.body;
ption } = res, descrie, filter search_typame,st { n    con{
  try {
s) =>  reeq,, async (rh'save-searc('/ostouter.pch query
r sear
// Save a}
});
s' });
  archeed seload savailed to  error: 'F500).json({tatus(;
    res.sor)or:', errarches err serror('Savedconsole.e {
    or)tch (err
  } ca);n'
    }ming soofeature cos rche'Saved seae:    messag  [],
 arches: aved_se  s   rue,
 ess: t    succ.json({
  resay
     arr emptynow, return  // For ble
  se ta in a databaved searchesre sauld stowotion, you mentamplel i// In a ful   
   try {> {
s) =eq, renc (rches', asy/saved-searget('outer.c)
rr-specifiarches (use saved seet
});

// G;
  }h users' })ed to searcrror: 'Failson({ etus(500).j
    res.staror); er',or:earch errer s usancedrror('Advonsole.e
    c (error) {

  } catch);   }
    }rder
   t_by, sort_o, sorportshas_res_devices, 
        hao,om, date_te, date_frified, activegion, verrch, role, r   sears: {
     d_filte  appliens,
    ptions: filterOter_optioil     f    },
 t)
  tal / limiesult[0].tontRth.ceil(cou pages: Ma
       [0].total,esultal: countRot  t
      eInt(limit),limit: pars  e),
      Int(pagrse  page: pa      {
 ion:paginat
      zedUsers,sanitirs:    use true,
   success:  son({
    

    res.jtions();ilterOptUserFwait geons = atit filterOpns
    consr optioGet filte/ 

    /ams);ar}
    `, p{whereClauseWHERE $    ' ')}
  .join( ${joins  s u
   ROM user    Fas total
  u.id) (DISTINCT UNT CO    SELECT`
  .query(aseait Datab awntResult = cou const query
   / Count
    /
);d;
    }thoutPassworrWise return uuser;
     assword } = serWithoutP.ush, ..assword_ha const { p     => {
er sers.map(uszedUsers = unst saniti  coashes
  word he passemov

    // R]);setimit), offarseInt(lms, p`, [...para
    ?T ? OFFSET IMI   Lon}
   ortDirectirtField} ${sso${DER BY       ORd
BY u.iROUP }
      GreClauseHERE ${whe    Wvice_id
  id = r2.des r2 ON d2. reportJOIN     LEFT 2.user_id
  dd =d2 ON u.iOIN devices LEFT J ')}
      join('s.oin ${js u
        FROM userrt_date
   st_repo as lareated_at)  MAX(r.c      tration,
gise_revicast_de as ld_at)ate.cre      MAX(d
  port_count, r.id) as reISTINCT COUNT(D
       vice_count,d) as deDISTINCT d.iT(UN        CO     u.*,
CT
   DISTINCT ELE   Sery(`
   tabase.quit Dausers = awanst     co
ueryn q // Mait;

   1) * limi= (page - t offset 

    cons() : 'DESC';aserCer.toUppe ? sort_orde())UpperCas_order.toes(sortinclud].'DESC' = ['ASC', onortDirectist s;
    coneated_at'cr: 'u.{sort_by}` y) ? `u.$sort_b.includes(SortFieldsld = validt sortFiecons   '];
 verified_ated_at', 'at', 'creion', 'reg', 'roleme', 'emailields = ['na validSortFstconrs
    meteraate sort pa Valid //
    }
_id');
   r.deviced = ON d.irts r OIN repons.push('J}
      joi  ');
     = d.user_ides d ON u.idOIN devic'Jjoins.push(       
 d'))) {('devices > j.includess.some(j = if (!join    
 'true') {reports ===   if (has_
  
    }
'; NULLd.id ISe += ' AND whereClaus');
      .user_id = dd ON u.iddevices FT JOIN LEins.push('jo    {
   se') === 'faldevices if (has_se } el
   d');r_iseu.id = d.uN d Oes OIN devic('Jns.push{
      joi 'true') ices ===_devas  if (h

   }o);
   .push(date_t params
     ';d_at) <= ?TE(u.createND DAe += ' AClaus   where
   o) {f (date_t    i}

m);
    _fro(datearams.push      p;
>= ?'eated_at) ND DATE(u.cr ' AereClause +=     wh
 m) {ate_fro(d}

    if ';
    t IS NULLerified_aAND u.v' eClause +=  wher') {
      'false==erified = if (v
    } else NULL';IS NOTified_at  ' AND u.verlause +=  whereCue') {
    === 'tred ifi    if (ver
    }

ion);ush(regrams.p;
      paregion = ?'D u.+= ' ANhereClause  w
      {region)
    if (}
   }
    e);
   ms.push(rol       parale = ?';
 ' AND u.roClause +=    wheree {
     ls } ele);
     h(...roams.pus      par',')})`;
  ').join((() => '?mapN (${role.le Iu.ro AND  += ` whereClause       le)) {
(rosArrayay.i (Arr    if
  ) {role    if (   }


 chTerm);m, sear(searchTerparams.push%`;
      earch}`%${s= chTerm st sear     conKE ?)';
  u.email LIIKE ? OR LD (u.nameause += ' ANClere
      wh{arch) 
    if (serch filters// Build sea;

    joins = [] let = [];
   et params ';
    l1=1Clause = 't where  le
  ;
eq.query = r   }20
     limit = 1,
   page =     ',
 = 'DESC sort_order      at',
= 'created_sort_by 
      ts,epor
      has_revices,as_d    h
  ate_to, d     e_from,
    dat    active,
fied,
    
      veriion,   rege,
   
      rolsearch,   st {
   
    con
  try {es) => {, rreq, async ('admin'])([ireRolequ'/users', reuter.get()
roadmin onlyrch (sea user // Advanced  }
});

s' });
 report searchto: 'Failed n({ errorus(500).jsoat
    res.sterror); error:', charseced report dvan.error('Ansole   coor) {
  catch (err  });

  }}
  rder
      _o_by, sorta, sort_led, assignedice_brandev, case_id   
     date_to,e_from, ategion, d, status, rtypeeport_earch, r
        slters: {pplied_fi
      aOptions,ns: filterter_optio,
      fil   }
   / limit)total 0].Result[ntcouth.ceil(  pages: Ma
      total,tResult[0].untal: co to
       imit),parseInt(l: mit     li),
   nt(pagepage: parseI  : {
      ationpaginrts,
      ts: repo    repor
  ess: true,
      succson({es.j;

    req.user)s(rilterOptiont getReportFwais = ailterOption    const f
nser optiolt fi    // Getms);

   `, parase}
 ClauRE ${whereWHE      = lea.id
lea_id ed_assigna ON r.ies le_agencenforcementT JOIN law_   LEF= u.id
   d.user_id u ON users  JOIN .id
     vice_id = ddeN r. ON devices dJOI  orts r
      FROM reptal
     as toT(*)ELECT COUN`
      Sbase.query(atat Dsult = awainst countRe  coy
   Count quer   //);

  offset]limit),seInt( par [...params,
    `,OFFSET ?  LIMIT ? n}
    irectio ${sortDrtField}RDER BY ${so      Oe}
lausE ${whereC
      WHER.ideporter rporter_id =.rer ON rterepor JOIN users   LEFT
    .ida_id = leaigned_lelea ON r.assgencies ment_alaw_enforceN FT JOI    LEu.id
  id = N d.user_ers u O JOIN usid
     id = d.e_ r.devicd ONs  JOIN devicer
     ports      FROM remail
 s reporter_e.email a   reporterme,
     r_nas reporteame a reporter.n
       ea_contact,il as lt_emaea.contac     l   ency_name,
     lea.agion,
    owner_reg as u.region      il,
 wner_emau.email as o
        er_name,e as ownnam       u.serial,
 d.  
      ei,   d.im
     l,   d.mode     nd,
     d.bra
       r.*, 
    CT     SELEuery(`
 atabase.q = await D reports
    const query// Maint;

    ) * limi - 1(paget offset =     cons

: 'DESC';erCase() er.toUpp) ? sort_orde()rCasppetoUsort_order.].includes(SC'ASC', 'DEtion = ['ecrtDirt soonst';
    ccreated_a: 'r.by}` r.${sort_sort_by) ? `ds.includes(lidSortFielvartField =  const son'];
   , 'locatio_at''created', rred_atcus', 'oce', 'staturt_typepoe_id', 'rds = ['casidSortFiel const vals
   rt parameter Validate so //  }

   }%`);
  eassigned_lsh(`%${apuparams.?';
      LIKE cy_name .agen+= ' AND leaereClause    whlea) {
   igned_ass

    if (}
    rand);vice_bderams.push(;
      pa = ?' d.brand ' ANDlause +=hereC
      wbrand) {vice_   if (de   }

 d}%`);
 `%${case_is.push( param     KE ?';
.case_id LID r+= ' ANlause reC whe{
     )  if (case_id

   
    }sh(date_to);ams.pu
      pard_at) <= ?';.create AND DATE(rause += 'ereCl     whate_to) {
  (d    if

   });
 e_fromams.push(dat      par) >= ?';
reated_atTE(r.c ' AND DAe +=reClaushe
      w) {e_fromat    if (d }

);
   regionparams.push( ?';
      gion =u.reAND ause += '      whereClegion) {
 
    if (r    }
;
      }
sh(status)puams.  par      tus = ?';
.staND ruse += ' AereCla        wh
  } else {tus);
    sta.push(...  params      (',')})`;
?').join() => 'us.map( (${stat r.status INuse += ` AND whereCla   {
    (status)) y.isArray(Arraif   us) {
    tat(s
    if  }
    }
ype);
     rt_tpoh(re.pusams
        par';t_type = ?D r.reporause += ' AN    whereCl
     } else {
     port_type);re(...shs.pu    param')})`;
    ?').join(',.map(() => '{report_typet_type IN ($ r.repor ANDe += `Claus   where) {
     report_type)sArray(ray.i      if (Arpe) {
_tyif (report}

        rchTerm);
 seaearchTerm,earchTerm, sarchTerm, srm, seush(searchTems.p    parah}%`;
   = `%${searct searchTerm cons    IKE ?)';
 d.model LOR  LIKE ? d.brand ? OR  LIKEcation? OR r.loKE iption LIr.descr OR d LIKE ?D (r.case_i AN 'eClause +=    wherarch) {
   if (sefilters
   d search il
    // Bun);
    }
ser.regioush(req.u params.p  ;
   ion = ?' u.reg' ANDreClause +=       whe {
= 'lea')ser.role ==req.u (e if elsd);
    }user.i(req.push     params.';
 er_id = ? ' AND d.us+=se hereClau
      w { === 'user')eq.user.role    if (rontrol
ed access cle-bas
    // Roms = [];
t para   le= '1=1';
 Clause re let whe
   eq.query;
    } = rimit = 20
      l= 1,

      page C',rder = 'DES    sort_oted_at',
  creaby = '    sort_d_lea,
  igne   ass_brand,
   cedevi   
   e_id,    casto,
  te_
      dadate_from,      gion,
   res,
   tu   sta
   ort_type,    reph,
    searconst {
    {
    c try res) => {
 req,  async (eports','/r.get(outerearch
report sdvanced r// A

 }
});
 ces' }); devi to searchr: 'Failedon({ erroatus(500).js res.st;
   or) errrror:',earch edevice s('Advanced nsole.error    co{
 (error)   } catch});

   }
    rder
   ort_o, srt_byeports, soas_ried_only, h verifo, 
       _tdatedate_from, region,  status, d, model,ch, bran      sear  rs: {
ilte_fpliedapons,
      : filterOptionsr_opti     filte
    },  limit)
 tal / Result[0].toceil(countges: Math.      patotal,
  [0].ult countResotal:   t
     ,t(limit)Inmit: parse      li,
  ge)pa parseInt(     page:n: {
    paginatio
     ces,vis: deice    dev  
ue,uccess: tr  s   
 n({
    res.jso);
sertions(req.uiceFilterOpawait getDevtions = terOp fil constend
    for frontlter optionsfiGet  // 
   ams);
, parse}
    `hereClauE ${w
      WHER ')}ins.join('
      ${joM devices d      FROotal
id) as tINCT d.(DISTSELECT COUNT    (`
  se.queryDatabaait esult = awntR   const cou
 unt queryCo
    // t]);
 offset),t(limi parseInms, `, [...para
    ? OFFSET ?   LIMIT}
   irectioneld} ${sortD${sortFiORDER BY .id
      OUP BY d
      GRhereClause}HERE ${w
      W_idrep.deviced = p ON d.i rertsJOIN repoLEFT      ')}
 oins.join(' 
      ${j devices d      FROMrt_types
 as repotype)rt_ep.repoDISTINCT rCAT(   GROUP_CONdate,
     last_report_ed_at) as eat MAX(rep.cr    ount,
    as report_c.id)TINCT rep(DISOUNT
        Cn,wner_region as ogio       u.rer_email,
 as owneu.email ,
        ner_name.name as ow    u  d.*,
    
      DISTINCTT SELEC  (`
    base.query= await Datast devices conery
    ain qu
    // Mmit;
e - 1) * li = (pagfset   const of

 ) : 'DESC';toUpperCase(der.rt_or? sorCase()) ppe_order.toUludes(sortnc'DESC'].i, on = ['ASC'ectist sortDir
    coned_at';reat.ct_by}`) : 'd`d.${sorname' : name' ? 'u.r_net_by === 'ow
      (sor(sort_by) ? desnclulds.itFie validSortField =  const sor'];
  ner_name', 'ow_at', 'verifiedd_at, 'createtus'model', 'stad', 'ran'btFields = [Sorconst valid  ers
  paramete sort  Validat

    //}  ;
   NULL'.id IS+= ' AND rhereClause    w);
   .device_id'id = r ON d.rts rN repoT JOIsh('LEF  joins.pu
    lse') {'fa== s =has_report} else if (    ';
T NULL.id IS NO AND ruse += '    whereClad');
  ce_i= r.deviid rts r ON d.OIN repopush('Js.in     jo {
 rue')s === 't_reporthasif (   
    }

 d"';rifie"vetatus = ND d.s= ' Aause +hereCl     wue') {
 == 'tr =ied_onlyeriff (v

    i   }
 to);ush(date_  params.p<= ?';
    created_at)  DATE(d.' ANDlause +=     whereC
  to) { if (date_}

   ;
    (date_from)push     params.= ?';
 ted_at) >.creaATE(d += ' AND DeClausewher    {
   m)ate_fro if (d    }

   
on);(regipush params.
     ';n = ?.regio' AND ueClause +=   wher) {
     if (region
   }
    }
  
    tatus);.push(s    params ?';
     =AND d.statuslause += ' eC   wherlse {
     
      } e..status);.push(. params    )})`;
   (','=> '?').joinap(() status.matus IN (${ d.st += ` ANDeClause    wher   
 )) {tustaisArray(s if (Array.
     f (status) { }

    i
   );ush(modelms.p     para?';
 l = deD d.mo ' ANClause +=  where) {
    elod

    if (m  }nd);
  ms.push(bra para   ?';
  brand = ND d.use += ' AhereCla     w{
 d) an
    if (br
;
    }rchTerm)hTerm, searm, searcearchTehTerm, srm, searcTeh(searchams.pus  par
    rch}%`;${searm = `%archTe   const se   LIKE ?)';
e .namOR uial LIKE ?  OR d.serE ? d.imei LIK? ORodel LIKE OR d.mIKE ? d LND (d.branlause += ' AwhereCh) {
        if (searcers
  search filt // Build 

    all devicesdmin can see  // A
    }
  er.region);req.usarams.push(
      p;= ?' u.region se += ' ANDhereClau{
      wea') 'lr.role === f (req.use} else ir.id);
    (req.usems.pushara      p_id = ?';
user= ' AND d.hereClause +
      wr') {se'ur.role === eq.use (r
    ifrolontss ce-based acce Rol

    //.id'];id = ud.user_ ON rs uuse= ['JOIN oins t jle[];
    s = et param   l= '1=1';
 ereClause    let why;

 } = req.quer = 20
    
      limit1,     page = DESC',
 rt_order = '
      soeated_at', = 'cr    sort_by
  orts,as_rep,
      hied_onlyrif ve  e_to,
   
      datte_from,,
      da     region
   status,  
      model,    brand,
rch,
      seast {
    {
    con  try  res) => {
(req,ync , asdevices'outer.get('/h
rarcd device sevance

// Aden);Tokcateuthentiuter.use(ation
roe authenticaires requutAll ro

// uter();.Ror = expressconst routeuth');

iddleware/ae('../mrequirireRole } = equ rToken,icate