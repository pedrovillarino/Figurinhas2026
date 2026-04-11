import { useEffect } from 'react'

/**
 * Trava o scroll do body enquanto um modal/bottom sheet está aberto.
 * Restaura a posição de scroll ao fechar.
 * Necessário no iOS para evitar que o scroll vaze para a página de fundo.
 */
export function useBodyScrollLock(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return

    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    return () => {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [isOpen])
}
