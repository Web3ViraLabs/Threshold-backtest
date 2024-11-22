if you are the results, there is a lot wrong going on with the backtesting system

The strategy should work as follows:

precandles are number of candles which are presumed to check dynamicThrshold
calculate averageDiff of previousCandles (number of previous candles is configured in config file)
then the value is multiplied with the threshold given in config \* averageDiff
this value is called dynamic Threshold

now we check every candle after the pre-candles the if the difference of a candle which is called currentDiff is greator or equal to dynamicThreshold

once a currentDiff of a candle is greator or equal to dynamic threshold that candle is called LegendCandle
we will calculate movementThreshold
movementThreshold is dynamicThreshold only but there are two types of movementThreshold

1. upward_movementThreshold
2. downward_movementThreshold

lets say dynamicThreshold is 5%
movementThreshold is 5%

from the closePrice of Legend candle we will calculate upward_movementThreshold and downward_movementThreshold
lets assume close price of the legendCandle is 180 then

upward_movementThreshold = 180 + 5% = 189
downward_movementThreshold = 180 - 5% = 171

now we will start looking candle from the next candle of legendCandle

weather the price touches (greator or equal to) upward_movementThreshold if this happens then its a signal for long position
so once the upward_movementThreshold meets, then we take long position immidiately

if the price touches (lessor or equal to) downward_movementThreshold then its a signal for short position, should be taken immidiately

so the entry of long position will be the upward_movementThreshold
of if it touches first downward_movementThreshold then downward_movementThreshold will the entry of short position

so now we have either taken entry for short or long order
we will add initial stop loss for any position we take
if long position then: entryprice - dynamicThreshold %
lets take the same example
189 will be the entry of position then, initial stoploss will be 189 - 5% (9) = 180 (initial stoploss)

if its short position then,
171 + dynamicThreshold (5%, which is 9) = 180

technically, the initial_stoploss for both long and short position would be same

now we come up with Trailing stop loss concept,
you would already know what trailing stop loss is,

we have two things to calculate for trailing stop loss

1. TriggerPrice
2. StopLosses

to lets assume we got long position with same example:

we took entry at 189
initial stoploss is 180

trigger 01 = 189 + dynamicThreshold (5%, 9) = 197
stoploss 01 = trigger 01 - dynamicThreshold (5%, 9) = 189

trigger 02 = trigger 01 + dynamicThreshold (5%, 9) = 206
stoploss 02 = trigger 02 - dynamicThreshold (5%, 9) = 197

trigger 03 = trigger 02 + dynamicThreshold (5%, 9) = 215
stoploss 03 = trigger 03 - dynamicThreshold (5%, 9) = 206

this way the triggers is calculated and stoploss will be trailied
triggerPrice is caculated and then we keep checking candles after position taken candle
once price crosses each trigger the stoploss is Updated,

if price crosses trigger 01 then stoploss 01 is placed
prices crosses trigger 02 then stoploss 02 is placed
this keeps on going unless the price hits a stoploss, either initial stoploss or stoploss 01, 02...) any of one active stoploss
as ive already told, active stoploss keep shifting, as the price crosses triggers, their respective stoploss will be placed which will become the active stop loss ..

the price should either touch the trigger and active Stop loss is updated based on trigger or the price hits active stoploss and the position is closed
this trailing keeps trailing unless a stoploss gets hit, it keeps triggering triggers and keep updating stoploss which is all we want,

and hence vice versa for short orders,

we took entry at 171
initial stoploss is 180

trigger 01 = 171 - dynamicThreshold (5%, 9) = 162
stoploss 01 = trigger 01 + dynamicThreshold (5%, 9) = 171

trigger 02 = trigger 01 - dynamicThreshold (5%, 9) = 153
stoploss 02 = trigger 02 + dynamicThreshold (5%, 9) = 162

trigger 03 = trigger 02 + dynamicThreshold (5%, 9) = 144
stoploss 03 = trigger 03 + dynamicThreshold (5%, 9) = 153

this keeps happening unless the active stop loss it hit before the next trigger is touched

this is the whole strateg, but the results which it is generating doesn't seem correct, this made me explain you the whole strategy

once activestoploss is touched, position is closed and we calculate pnl, based on number of triggers the position has crosses
lets say on each position we profit 9$ then number of triggers is 3 then we get 27 usdt in profit
if price hits initial stoploss before even trigger 01 is triggered then is -9$ loss on that position

once we calculate we store the info in results json format for all symbol and all timeframes
