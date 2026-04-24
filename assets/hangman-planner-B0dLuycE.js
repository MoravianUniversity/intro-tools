import{i as e}from"./function-planner-CKmk2wE4.js";import"./ui-BOE0KQBr.js";import"./yjs-DU2MbpST.js";const s={functions:[{key:1,name:"main",io:"indirect",code:`# Get the random word from the list of words
word = select_word()
# Play the game and print out the final results
if play_game(word):
    print(f"Congratulations! The word was '{word}'")
else:
    print(f"Too many mistakes... The word was '{word}'")`,showCode:!0,readOnly:["name","desc","params","returns","io","testable","code"]},{key:2,name:"read_words",desc:"Read all of the words from the given file into a list.",params:[{name:"filename",type:"str",desc:"the name of the file to get the words from"}],returns:[{type:"list of str",desc:"the words from the file"}],code:`with open(filename) as file:
    return file.read().split()`,showCode:!0,readOnly:["name","desc","params","returns","io","testable","code"]},{key:3,name:"play_game",desc:"Play a game with the given word (and return True if the user won (guessed the word) and False if the user lost (made 5 mistakes).",params:[{name:"word",type:"str",desc:"the word that is being guessed"}],returns:[{type:"bool",desc:"True if the user won the game, False otherwise"}],io:"indirect",code:`# Create a word that is the same length as word but is all _ characters
guessed_word = "_" * len(word)

# Play rounds until the guessed word is complete or the user has 5 mistakes
guessed_letters = []
mistakes = 0
while not game_is_over(word, guessed_word, mistakes):
    print_status(guessed_word, mistakes, guessed_letters)
    guessed_word, mistakes = play_round(word, guessed_word, guessed_letters, mistakes)
    print()

# Return if the user won or lost
return guessed_word == word`,showCode:!0,readOnly:["name","desc","params","returns","io","testable","code"]},{key:4,name:"update_guessed_word",desc:"Create a new guessed word, replacing the corresponding _ with the guessed letter.",params:[{name:"word",type:"str",desc:"the actual word that is being guessed"},{name:"guessed_word",type:"str",desc:"the word that has been guessed so far with at least a few blanks remaining it"},{name:"guessed_letter",type:"str",desc:"the letter that has been guessed, fills in some of the blanks"}],returns:[{type:"str",desc:"the new guessed word with the guessed letter filled in"}],io:"none",testable:!0,code:`new_guessed_word = ""
for word_char, guessed_char in zip(word, guessed_word):
    if word_char == guessed_letter:
        new_guessed_word += guessed_letter
    else:
        new_guessed_word += guessed_char
return new_guessed_word`,testCode:`assert hangman.update_guessed_word("apple", "_____", "a") == "a____"
assert hangman.update_guessed_word("apple", "a____", "p") == "app__"
assert hangman.update_guessed_word("apple", "app__", "l") == "appl_"
assert hangman.update_guessed_word("apple", "appl_", "e") == "apple"
assert hangman.update_guessed_word("apple", "_____", "p") == "_pp__"
assert hangman.update_guessed_word("hello", "_____", "e") == "_e___"
assert hangman.update_guessed_word("hello", "_e___", "o") == "_e__o"
assert hangman.update_guessed_word("str", "___", "z") == "___"
assert hangman.update_guessed_word("str", "str", "r") == "str"
assert hangman.update_guessed_word("str", "str", "p") == "str"`,showCode:!0,showTestCode:!0,readOnly:["name","desc","params","returns","io","testable","code","testCode"]}],calls:[]};window.addEventListener("DOMContentLoaded",()=>{e("planner","hangman",{initialModel:s,allowedTypes:["int","float","str","bool","list"],minFunctions:9,minTestable:2,adminMode:!1})});
