/**
 * 错题本 / 收藏夹共用的「一轮练习」状态（Vue composable）。
 *
 * 交互约定：
 *  · 一次只出一题，作答后保留对错颜色与解析，留在本页供检查，不自动跳走；
 *  · 每题每轮只判一次，杜绝「提示完还能连续作答」；
 *  · ← / → 循环翻上一题 / 下一题，末题往右回首题；
 *  · 整轮全部处理完后，再从末题往右：清空本轮作答、回到第一题重新刷。
 *
 * @param {import('vue').Ref<Array<{id:string}>>} list 当前筛选后的题目列表（computed / ref）
 * @param {{ onNewRound?: (round:number)=>void|Promise<void>, scrollSel?: string }} opts
 */
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { onKey } from './keys'
import { wrapIndex, atLast, isDone, isRoundDone } from './practice'

export function usePracticeRound(list, opts = {}) {
  const { onNewRound, scrollSel = '.stage' } = opts
  const i = ref(0)
  const picked = ref({})     // qid -> 选中的字母
  const revealed = ref({})   // qid -> true（看过答案，不计分）
  const round = ref(1)
  let offKey = null

  const cur = computed(() => list.value[i.value] || null)
  const ids = computed(() => list.value.map((q) => q.id))
  const doneCount = computed(() =>
    list.value.reduce((n, q) => n + (isDone(q.id, picked.value, revealed.value) ? 1 : 0), 0)
  )
  const roundDone = computed(() => isRoundDone(ids.value, picked.value, revealed.value))

  function done(qid) {
    return isDone(qid, picked.value, revealed.value)
  }
  function markAnswer(qid, letter) {
    picked.value = { ...picked.value, [qid]: letter }
  }
  function markReveal(qid) {
    revealed.value = { ...revealed.value, [qid]: true }
  }
  function clearAnswers() {
    picked.value = {}
    revealed.value = {}
  }

  /** 列表被重建（同步到新错题 / 取消收藏）时尽量停在原来那道题上 */
  function keepAnchor(qid) {
    const k = qid ? list.value.findIndex((q) => q.id === qid) : -1
    i.value = k >= 0 ? k : Math.min(i.value, Math.max(0, list.value.length - 1))
  }
  // 列表缩短后下标可能越界（异步重建时序不确定，这里兜底一次）
  watch(() => list.value.length, () => {
    if (i.value >= list.value.length) i.value = Math.max(0, list.value.length - 1)
  })

  function scrollTop() {
    nextTick(() => {
      document.querySelector(scrollSel)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function go(d) {
    const n = list.value.length
    if (!n) return
    const from = Math.max(0, Math.min(n - 1, i.value))
    if (d > 0 && atLast(from, n) && roundDone.value) {
      // 整轮做完：清掉本轮作答，回到第一题重新刷
      clearAnswers()
      round.value++
      i.value = 0
      const r = round.value
      Promise.resolve(onNewRound?.(r)).finally(() => { i.value = 0 })
      scrollTop()
      return
    }
    i.value = wrapIndex(from, d, n)
    scrollTop()
  }

  /** 手动重开一轮（列表不变，只清作答） */
  function restart() {
    clearAnswers()
    round.value++
    i.value = 0
    const r = round.value
    onNewRound?.(r)
    scrollTop()
  }

  onMounted(() => {
    offKey = onKey((e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      go(e.key === 'ArrowRight' ? 1 : -1)
    })
  })
  onUnmounted(() => offKey && offKey())

  return {
    i, cur, picked, revealed, round, doneCount, roundDone,
    done, markAnswer, markReveal, clearAnswers, keepAnchor, go, restart,
  }
}
