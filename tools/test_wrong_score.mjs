import { WRONG_TARGET as NEED, scoreMap, replay } from '../src/lib/wrongScore.js'

let pass=0, fail=0
let t=1000
/** 构造一条作答记录 */
const mk=(qid,ok)=>({qid,ok,ts:t+=10,level:'技术级',sec:'T1A'})
function check(name, attempts, expect){
  const s=scoreMap(attempts).get(attempts[0].qid)||0
  const ok = s===expect
  ok?pass++:fail++
  console.log(`  ${ok?'✓':'✗'} ${name.padEnd(34)} 得分 ${s}（期望 ${expect}）`)
}

console.log('【基础累积】')
check('答错 1 次', [mk('T1A01',false)], 0)
check('错 → 对', [mk('T1A01',false),mk('T1A01',true)], 1)
check('错 → 对 对', [mk('T1A01',false),mk('T1A01',true),mk('T1A01',true)], 2)
check('错 → 对 对 对（满）', [mk('T1A01',false),mk('T1A01',true),mk('T1A01',true),mk('T1A01',true)], 3)

console.log('\n【答错扣一次】')
check('对 对 → 错（扣到1）', [mk('T1A01',false),mk('T1A01',true),mk('T1A01',true),mk('T1A01',false)], 1)
check('对 → 错（扣回0）', [mk('T1A01',false),mk('T1A01',true),mk('T1A01',false)], 0)
check('连续答错不会负分', [mk('T1A01',false),mk('T1A01',false),mk('T1A01',false)], 0)

console.log('\n【上限封顶 + 掌握后再错会回来】')
check('满分后再答对仍为3', [mk('T1A01',false),mk('T1A01',true),mk('T1A01',true),mk('T1A01',true),mk('T1A01',true)], 3)
check('满分后再答错退回2', [mk('T1A01',false),mk('T1A01',true),mk('T1A01',true),mk('T1A01',true),mk('T1A01',false)], 2)

console.log('\n【乱序输入：ts 打乱仍按时间回放】')
const a1=mk('T1A09',false), a2=mk('T1A09',true), a3=mk('T1A09',true)
check('顺序正确', [a1,a2,a3], 2)
check('顺序打乱 1', [a3,a1,a2], 2)
check('顺序打乱 2', [a2,a3,a1], 2)

console.log('\n【未答错过的题不计入错题本】')
const t2=[mk('T1A02',true),mk('T1A02',true),mk('T1A02',true)]
const r=replay(t2)
console.log(`  ${r.wrongSeen.size===0?'✓':'✗'} 全对的题不进 wrongSeen（实际 size=${r.wrongSeen.size}）`)
r.wrongSeen.size===0?pass++:fail++

console.log('\n【多题互不干扰】')
const mix=[mk('A',false),mk('B',false),mk('A',true),mk('B',true),mk('A',true),mk('B',false)]
const sm=scoreMap(mix)
const ok=sm.get('A')===2 && sm.get('B')===0
console.log(`  ${ok?'✓':'✗'} A=${sm.get('A')}(期望2) B=${sm.get('B')}(期望0)`)
ok?pass++:fail++

console.log(`\n结果：${pass} 通过 / ${fail} 失败  (NEED=${NEED})`)
process.exit(fail?1:0)
