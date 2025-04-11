export interface FeedbackItem {
    time: number
    msg: string
    userId: string
    handle: boolean
    up: boolean
    pic: string[]
    backMsg: Array<{
      name: string
      msg: string
    }>
  }
  
  export interface UserTempData {
    page: number
    content: FeedbackItem[]
    type: number
    select?: number
  }