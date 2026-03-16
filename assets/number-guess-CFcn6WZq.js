import{i as e}from"./function-planner-ByniQC8O.js";import"./ui-BFtFxnTg.js";import"./yjs-AbTu9oK0.js";window.addEventListener("DOMContentLoaded",()=>{e("planner","number-guess",{initialModel:{functions:[{key:1,name:"main",io:"indirect",code:`user_name = input("What's your name? ")
play_one_game(user_name)`,showCode:!0,readOnly:!0},{key:2,name:"get_guess_outcome",desc:"Checks a guessed number against an actual value, returning a value based on if it is less than, more than, or equal to the actual value. It also looks for values that are 'not even close'.",params:[{name:"guessed",type:"int",desc:"the guessed number"},{name:"actual",type:"int",desc:"the actual number to be guessed (i.e. the answer)"}],returns:[{type:"str",desc:"the message to show"}],io:"none",testable:!0,code:`diff = guessed - actual
if diff < 0:
    return 'Your guess was too low.'
elif diff < -20:
    return 'Your guess was too low (not even close)!'
elif diff > 0:
    return 'Your guess was too high.'
else:
    return 'Your guess was too high (not even close)!'`,showCode:!0,testCode:`# These are correct - do not change these!
assert number_guess.get_guess_outcome(1, 1) == 'Your guess was correct!'
assert number_guess.get_guess_outcome(50, 50) == 'Your guess was correct!'
assert number_guess.get_guess_outcome(1, 2) == 'Your guess was too low.'
assert number_guess.get_guess_outcome(1, 21) == 'Your guess was too low.'
assert number_guess.get_guess_outcome(1, 22) == 'Your guess was too low (not even close)!'
assert number_guess.get_guess_outcome(22, 1) == 'Your guess was too high (not even close)!'
assert number_guess.get_guess_outcome(21, 1) == 'Your guess was too high.'
assert number_guess.get_guess_outcome(2, 1) == 'Your guess was too high.'`,showTestCode:!0,readOnly:["name","desc","params","returns","io","testable","code","testCode"]},{key:3,name:"play_one_game",desc:`Plays a single number-guessing game with the user (whose name is given as an argument). To play the game, the computer thinks of a number, and then repeatedly:
    * gets a guess from the user
    * checks the guess against the computer's number
    * prints the outcome string
    * updates the allowed range for guesses
That stops once the user guesses the correct number. Then, the user is informed how many guesses it took them.`,params:[{name:"user_name",type:"str",desc:"the name of the user/game player"}],returns:[{type:"int",desc:"the number of guesses it took the user to guess the number"}],io:"indirect",code:`# The initial range of possible guesses, will be updated as the game progresses
min_guess = 1
max_guess = 100

# Have the computer think of a number
number = thinking_of_a_number(user_name)

# Initialize the number of guesses
num_guesses = 0

# Repeat until correctly guessed
correct = False
while not correct:
    correct, min_guess, max_guess = play_one_round(user_name, number, min_guess, max_guess)
    num_guesses += 1

# Display the results
display_result(user_name, num_guesses)

return num_guesses`,showCode:!0,readOnly:["name","desc","params","returns","io","testable","code"]}],calls:[{from:1,to:3}]},allowedTypes:["int","float","str","bool","list"],minFunctions:7,minTestable:1,minInputFunctions:2,maxInputFunctions:2,minOutputFunctions:4,maxOutputFunctions:4,adminMode:!1})});
