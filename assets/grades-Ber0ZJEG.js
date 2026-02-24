import{i as e}from"./function-planner-BHtH1y17.js";import"./ui-BFtFxnTg.js";import"./yjs-AbTu9oK0.js";const t={functions:[{key:1,name:"main",io:"indirect",readOnly:["name","desc","params","returns"]},{key:2,name:"read_list_of_students",desc:"Read all of the names of students from the given file into a list.",params:[],returns:[{type:"list of str",desc:"the student names from the file"}],io:"none",testable:!1,code:`with open("students.txt") as file:
    return [line.strip() for line in file]`,showCode:!0,readOnly:!0},{key:3,name:"get_new_grade",desc:"Get a new grade for the given student from the user. It is required to be an int between 0 and 100. If the user enters an invalid grade, they will be shown an error and prompted to enter a new one.",params:[{name:"student_name",type:"str",desc:"the student to get a grade for"}],returns:[{type:"int",desc:"the new grade for the student"}],io:"validation",testable:!1,code:`while True:
    try:
        grade = int(input(f"Enter the grade for {student_name}: "))
        if 0 <= grade <= 100:
            return grade
        else:
            print("Grade must be between 0 and 100.")
    except ValueError:
        print("Grade must be a number.")`,showCode:!0,readOnly:["name","desc","params","returns","io","testable","code"]},{key:4,name:"median",desc:"Calculate the median of the given list of grades.",params:[{name:"list_of_grades",type:"list of int",desc:"the grades to calculate the median of"}],returns:[{type:"float",desc:"the median of the grades"}],io:"none",testable:!0,testCode:`assert grades.median([1, 2, 3]) == 2
assert grades.median([100, 1, 3]) == 3
assert grades.median([1]) == 1
assert grades.median([2, 1]) == 1.5
assert grades.median([1, 2]) == 1.5
assert grades.median([0, 0]) == 0
assert grades.median([100, -1, 100, 100]) == 100
assert grades.median([0, 100, 100, 0]) == 50
`,showTestCode:!0,readOnly:["name","desc","params","returns","io","testable","testCode"]}],calls:[{from:1,to:2}]};window.addEventListener("DOMContentLoaded",()=>{e("planner","grades",{initialModel:t,allowedTypes:["int","float","str","bool","list"],minFunctions:8,minTestable:3,adminMode:!1})});
